use std::io::{self, Cursor, Seek, SeekFrom, Write};

use image::{DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, imageops::FilterType};
use thiserror::Error;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_PROCESSED_BYTES: usize = 10 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_DIMENSION: u32 = 2_048;
const THUMBNAIL_DIMENSION: u32 = 320;
const PROCESSED_LIMIT_ERROR: &str = "processed image exceeds limit";

#[derive(Debug)]
pub struct ProcessedAttachment {
    pub bytes: Vec<u8>,
    pub mime_type: &'static str,
    pub width: i32,
    pub height: i32,
}

/// 头像和活动封面共用的固定尺寸图片结果。
#[derive(Debug)]
pub struct ProcessedProfileImage {
    pub bytes: Vec<u8>,
    pub mime_type: &'static str,
    pub width: i32,
    pub height: i32,
}

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum AttachmentImageError {
    #[error("图片不能超过 10 MiB")]
    TooLarge,
    #[error("仅支持 JPEG、PNG 或 WebP 图片")]
    TypeNotAllowed,
    #[error("图片声明类型与实际内容不一致")]
    MimeMismatch,
    #[error("图片像素数量超过安全限制")]
    PixelLimitExceeded,
    #[error("图片内容损坏或无法解码")]
    InvalidImage,
}

/// 浏览器 MIME 只用于交叉校验；实际格式、尺寸和方向均从受限解码器读取。
///
/// # Errors
///
/// 输入超过大小或像素限制、类型不匹配、内容损坏或重编码失败时返回稳定错误。
pub fn process_attachment_image(
    bytes: &[u8],
    declared_mime: &str,
) -> Result<ProcessedAttachment, AttachmentImageError> {
    if bytes.len() > MAX_BYTES {
        return Err(AttachmentImageError::TooLarge);
    }
    let declared_format = format_for_mime(declared_mime)?;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let detected_format = reader
        .format()
        .filter(|format| {
            matches!(
                format,
                ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
            )
        })
        .ok_or(AttachmentImageError::TypeNotAllowed)?;
    if detected_format != declared_format {
        return Err(AttachmentImageError::MimeMismatch);
    }

    let mut decoder = reader
        .into_decoder()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let (width, height) = decoder.dimensions();
    validate_image_dimensions(width, height)?;
    let orientation = decoder
        .orientation()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|_| AttachmentImageError::InvalidImage)?;
    image.apply_orientation(orientation);
    let image = resize_without_enlargement(image);
    let width = image.width();
    let height = image.height();
    let mut output = LimitedImageWriter::new(MAX_PROCESSED_BYTES);
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|error| {
            if error.to_string() == PROCESSED_LIMIT_ERROR {
                AttachmentImageError::TooLarge
            } else {
                AttachmentImageError::InvalidImage
            }
        })?;
    Ok(ProcessedAttachment {
        bytes: output.into_inner(),
        mime_type: "image/webp",
        width: i32::try_from(width).map_err(|_| AttachmentImageError::InvalidImage)?,
        height: i32::try_from(height).map_err(|_| AttachmentImageError::InvalidImage)?,
    })
}

/// 校正 EXIF 方向后，以中心安全区域裁剪并输出固定尺寸 WebP。
///
/// 该入口只处理 JPEG/PNG/WebP，并复用附件上传的大小、像素数和 MIME 交叉校验，
/// 因而封面与头像不会绕过现有图片安全边界。输出不包含原始元数据。
///
/// # Errors
///
/// 输入超过大小或像素限制、类型不匹配、内容损坏或重编码失败时返回稳定错误。
pub fn process_fixed_image(
    bytes: &[u8],
    declared_mime: &str,
    target_width: u32,
    target_height: u32,
) -> Result<ProcessedProfileImage, AttachmentImageError> {
    if target_width == 0 || target_height == 0 {
        return Err(AttachmentImageError::InvalidImage);
    }
    if bytes.len() > MAX_BYTES {
        return Err(AttachmentImageError::TooLarge);
    }
    let declared_format = format_for_mime(declared_mime)?;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let detected_format = reader
        .format()
        .filter(|format| {
            matches!(
                format,
                ImageFormat::Jpeg | ImageFormat::Png | ImageFormat::WebP
            )
        })
        .ok_or(AttachmentImageError::TypeNotAllowed)?;
    if detected_format != declared_format {
        return Err(AttachmentImageError::MimeMismatch);
    }
    let mut decoder = reader
        .into_decoder()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let (width, height) = decoder.dimensions();
    validate_image_dimensions(width, height)?;
    let orientation = decoder
        .orientation()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|_| AttachmentImageError::InvalidImage)?;
    image.apply_orientation(orientation);

    let source_is_wider = u64::from(image.width()) * u64::from(target_height)
        > u64::from(image.height()) * u64::from(target_width);
    let (crop_width, crop_height) = if source_is_wider {
        (
            u32::try_from(
                (u64::from(image.height()) * u64::from(target_width)
                    + u64::from(target_height) / 2)
                    / u64::from(target_height),
            )
            .map_err(|_| AttachmentImageError::InvalidImage)?
            .max(1),
            image.height(),
        )
    } else {
        (
            image.width(),
            u32::try_from(
                (u64::from(image.width()) * u64::from(target_height) + u64::from(target_width) / 2)
                    / u64::from(target_width),
            )
            .map_err(|_| AttachmentImageError::InvalidImage)?
            .max(1),
        )
    };
    let x = image.width().saturating_sub(crop_width) / 2;
    let y = image.height().saturating_sub(crop_height) / 2;
    let image = image
        .crop_imm(
            x,
            y,
            crop_width.min(image.width()),
            crop_height.min(image.height()),
        )
        .resize_exact(target_width, target_height, FilterType::Lanczos3);
    let mut output = LimitedImageWriter::new(MAX_PROCESSED_BYTES);
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|error| {
            if error.to_string() == PROCESSED_LIMIT_ERROR {
                AttachmentImageError::TooLarge
            } else {
                AttachmentImageError::InvalidImage
            }
        })?;
    Ok(ProcessedProfileImage {
        bytes: output.into_inner(),
        mime_type: "image/webp",
        width: i32::try_from(target_width).map_err(|_| AttachmentImageError::InvalidImage)?,
        height: i32::try_from(target_height).map_err(|_| AttachmentImageError::InvalidImage)?,
    })
}

/// 限制重编码输出缓冲区，避免异常输入让 WebP 结果无限增长后才被动拒绝。
struct LimitedImageWriter {
    bytes: Vec<u8>,
    limit: usize,
    position: usize,
}

impl LimitedImageWriter {
    fn new(limit: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(limit.min(64 * 1024)),
            limit,
            position: 0,
        }
    }

    fn into_inner(self) -> Vec<u8> {
        self.bytes
    }
}

impl Write for LimitedImageWriter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let Some(end) = self.position.checked_add(buffer.len()) else {
            return Err(io::Error::other(PROCESSED_LIMIT_ERROR));
        };
        if end > self.limit {
            return Err(io::Error::other(PROCESSED_LIMIT_ERROR));
        }
        if self.position > self.bytes.len() {
            self.bytes.resize(self.position, 0);
        }
        if end > self.bytes.len() {
            self.bytes.resize(end, 0);
        }
        self.bytes[self.position..end].copy_from_slice(buffer);
        self.position = end;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Seek for LimitedImageWriter {
    fn seek(&mut self, position: SeekFrom) -> io::Result<u64> {
        let current =
            i128::try_from(self.position).map_err(|_| io::Error::other(PROCESSED_LIMIT_ERROR))?;
        let end = i128::try_from(self.bytes.len())
            .map_err(|_| io::Error::other(PROCESSED_LIMIT_ERROR))?;
        let next = match position {
            SeekFrom::Start(offset) => i128::from(offset),
            SeekFrom::Current(offset) => current + i128::from(offset),
            SeekFrom::End(offset) => end + i128::from(offset),
        };
        let limit =
            i128::try_from(self.limit).map_err(|_| io::Error::other(PROCESSED_LIMIT_ERROR))?;
        if !(0..=limit).contains(&next) {
            return Err(io::Error::other(PROCESSED_LIMIT_ERROR));
        }
        self.position =
            usize::try_from(next).map_err(|_| io::Error::other(PROCESSED_LIMIT_ERROR))?;
        u64::try_from(next).map_err(|_| io::Error::other(PROCESSED_LIMIT_ERROR))
    }
}

/// 验证解码前可读取的尺寸，避免为超大像素图片分配缓冲区。
///
/// # Errors
///
/// 尺寸为零或总像素超过四千万时返回对应安全错误。
pub fn validate_image_dimensions(width: u32, height: u32) -> Result<(), AttachmentImageError> {
    if width == 0 || height == 0 {
        return Err(AttachmentImageError::InvalidImage);
    }
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(AttachmentImageError::PixelLimitExceeded);
    }
    Ok(())
}

/// 将已通过安全处理的 WebP 附件压缩为卡片缩略图。
///
/// 缩略图不写入附件存储，避免为历史图片增加迁移；下载接口只在卡片请求时
/// 生成它，完整图片仍保持原始处理后的尺寸供用户打开原图。
///
/// # Errors
///
/// 已存储的 WebP 无法解码、尺寸超过安全上限或重编码失败时返回稳定错误。
pub fn thumbnail_attachment_image(bytes: &[u8]) -> Result<Vec<u8>, AttachmentImageError> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    if reader.format() != Some(ImageFormat::WebP) {
        return Err(AttachmentImageError::InvalidImage);
    }
    let decoder = reader
        .into_decoder()
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    let (width, height) = decoder.dimensions();
    validate_image_dimensions(width, height)?;
    let mut image =
        DynamicImage::from_decoder(decoder).map_err(|_| AttachmentImageError::InvalidImage)?;
    if image.width() > THUMBNAIL_DIMENSION || image.height() > THUMBNAIL_DIMENSION {
        image = image.thumbnail(THUMBNAIL_DIMENSION, THUMBNAIL_DIMENSION);
    }
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    Ok(output.into_inner())
}

fn format_for_mime(mime: &str) -> Result<ImageFormat, AttachmentImageError> {
    match mime {
        "image/jpeg" => Ok(ImageFormat::Jpeg),
        "image/png" => Ok(ImageFormat::Png),
        "image/webp" => Ok(ImageFormat::WebP),
        _ => Err(AttachmentImageError::TypeNotAllowed),
    }
}

fn resize_without_enlargement(image: DynamicImage) -> DynamicImage {
    if image.width() <= MAX_DIMENSION && image.height() <= MAX_DIMENSION {
        image
    } else {
        image.resize(MAX_DIMENSION, MAX_DIMENSION, FilterType::Lanczos3)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Rgba, RgbaImage};

    #[test]
    fn processed_webp_writer_rejects_output_before_growing_past_limit() {
        let mut writer = LimitedImageWriter::new(4);
        assert!(writer.write_all(b"1234").is_ok());
        assert_eq!(
            writer.write_all(b"5").unwrap_err().to_string(),
            PROCESSED_LIMIT_ERROR
        );
        assert_eq!(writer.bytes.len(), 4);
    }

    #[test]
    fn fixed_image_center_crops_and_outputs_requested_dimensions() {
        let source: RgbaImage = ImageBuffer::from_fn(800, 400, |x, _y| {
            if (100..=700).contains(&x) {
                Rgba([0, 180, 120, 255])
            } else {
                Rgba([255, 0, 0, 255])
            }
        });
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(source)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let result = process_fixed_image(bytes.get_ref(), "image/png", 512, 512).unwrap();
        assert_eq!((result.width, result.height), (512, 512));
        assert_eq!(result.mime_type, "image/webp");
        let decoded =
            image::load_from_memory_with_format(&result.bytes, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (512, 512));
    }

    #[test]
    fn fixed_image_outputs_cover_dimensions() {
        let source: RgbaImage = ImageBuffer::from_pixel(400, 300, Rgba([20, 80, 140, 255]));
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(source)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        let result = process_fixed_image(bytes.get_ref(), "image/png", 1200, 900).unwrap();
        assert_eq!((result.width, result.height), (1200, 900));
        let decoded =
            image::load_from_memory_with_format(&result.bytes, ImageFormat::WebP).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (1200, 900));
    }

    #[test]
    fn fixed_image_rejects_oversized_input_and_pixel_count() {
        let oversized = vec![0; MAX_BYTES + 1];
        assert!(matches!(
            process_fixed_image(&oversized, "image/png", 512, 512),
            Err(AttachmentImageError::TooLarge)
        ));
        assert_eq!(
            validate_image_dimensions(10_000, 4_001),
            Err(AttachmentImageError::PixelLimitExceeded)
        );
    }

    #[test]
    fn fixed_image_rejects_mismatched_mime_before_decoding() {
        assert!(matches!(
            process_fixed_image(b"not-an-image", "image/jpeg", 1200, 900),
            Err(AttachmentImageError::TypeNotAllowed)
        ));
    }
}

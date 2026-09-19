use std::io::Cursor;

use image::{DynamicImage, ImageDecoder as _, ImageFormat, ImageReader, imageops::FilterType};
use thiserror::Error;

const MAX_BYTES: usize = 10 * 1024 * 1024;
const MAX_PIXELS: u64 = 40_000_000;
const MAX_DIMENSION: u32 = 2_048;
const THUMBNAIL_DIMENSION: u32 = 320;

#[derive(Debug)]
pub struct ProcessedAttachment {
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
    let mut output = Cursor::new(Vec::new());
    image
        .write_to(&mut output, ImageFormat::WebP)
        .map_err(|_| AttachmentImageError::InvalidImage)?;
    Ok(ProcessedAttachment {
        bytes: output.into_inner(),
        mime_type: "image/webp",
        width: i32::try_from(width).map_err(|_| AttachmentImageError::InvalidImage)?,
        height: i32::try_from(height).map_err(|_| AttachmentImageError::InvalidImage)?,
    })
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

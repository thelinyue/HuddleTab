use std::{fs, io::Cursor};

use huddletab_server::infrastructure::{
    attachment_image::{AttachmentImageError, process_attachment_image, validate_image_dimensions},
    attachment_store::{AttachmentStoreError, LocalAttachmentStore},
};
use image::{DynamicImage, GenericImageView as _, ImageFormat, RgbaImage};
use uuid::Uuid;

fn encoded_image(width: u32, height: u32, format: ImageFormat) -> Vec<u8> {
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(RgbaImage::new(width, height))
        .write_to(&mut bytes, format)
        .expect("测试图片应可编码");
    bytes.into_inner()
}

fn png_1_by_1() -> Vec<u8> {
    encoded_image(1, 1, ImageFormat::Png)
}

fn orientation_six_jpeg() -> Vec<u8> {
    let jpeg = encoded_image(2, 1, ImageFormat::Jpeg);
    let exif = [
        b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1, 0,
        0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
    ];
    let mut oriented = Vec::with_capacity(jpeg.len() + exif.len() + 4);
    oriented.extend_from_slice(&jpeg[..2]);
    oriented.extend_from_slice(&[0xff, 0xe1, 0x00, 0x22]);
    oriented.extend_from_slice(&exif);
    oriented.extend_from_slice(&jpeg[2..]);
    oriented
}

fn storage_key() -> String {
    format!(
        "{}/{}/{}.webp",
        Uuid::new_v4(),
        Uuid::new_v4(),
        Uuid::new_v4()
    )
}

#[test]
fn rejects_disallowed_type_mismatch_size_and_pixel_limit() {
    assert_eq!(
        process_attachment_image(b"<svg/>", "image/svg+xml").unwrap_err(),
        AttachmentImageError::TypeNotAllowed,
    );
    assert_eq!(
        process_attachment_image(&png_1_by_1(), "image/jpeg").unwrap_err(),
        AttachmentImageError::MimeMismatch,
    );
    assert_eq!(
        process_attachment_image(&vec![0_u8; 10 * 1024 * 1024 + 1], "image/jpeg").unwrap_err(),
        AttachmentImageError::TooLarge,
    );
    assert_eq!(
        validate_image_dimensions(8_000, 5_001).unwrap_err(),
        AttachmentImageError::PixelLimitExceeded,
    );
}

#[test]
fn valid_png_is_reencoded_as_webp_and_resized_without_enlargement() {
    let large =
        process_attachment_image(&encoded_image(3_000, 1_000, ImageFormat::Png), "image/png")
            .expect("合法 PNG 应可处理");
    assert_eq!((large.width, large.height), (2_048, 683));
    assert_eq!(large.mime_type, "image/webp");
    assert_eq!(&large.bytes[..4], b"RIFF");
    assert_eq!(&large.bytes[8..12], b"WEBP");
    assert_eq!(
        image::load_from_memory_with_format(&large.bytes, ImageFormat::WebP)
            .expect("输出应为可解码 WebP")
            .dimensions(),
        (2_048, 683)
    );

    let small = process_attachment_image(&png_1_by_1(), "image/png").expect("小图不应被拒绝或放大");
    assert_eq!((small.width, small.height), (1, 1));
}

#[test]
fn jpeg_orientation_is_applied_and_metadata_is_removed() {
    let result = process_attachment_image(&orientation_six_jpeg(), "image/jpeg")
        .expect("带合法方向元数据的 JPEG 应可处理");

    assert_eq!((result.width, result.height), (1, 2));
    assert!(
        !result.bytes.windows(4).any(|window| window == b"Exif"),
        "重编码结果不得保留 EXIF 元数据"
    );
}

#[tokio::test]
async fn store_round_trips_atomically_and_rejects_invalid_keys() {
    let root = tempfile::tempdir().expect("应创建临时 uploads 根目录");
    let store = LocalAttachmentStore::new(root.path()).expect("合法根目录应可使用");
    let key = storage_key();

    store
        .write(&key, b"processed-webp")
        .await
        .expect("应原子写入附件");
    assert_eq!(
        store.read(&key).await.expect("应读取附件"),
        b"processed-webp"
    );
    assert!(
        fs::read_dir(root.path())
            .expect("应遍历根目录")
            .all(|entry| !entry.expect("目录项应有效").path().is_file()),
        "根目录不得残留临时文件"
    );

    for invalid in [
        "",
        "../escape.webp",
        "/absolute.webp",
        "not-a-uuid/file.webp",
    ] {
        assert_eq!(
            store.write(invalid, b"changed").await.unwrap_err(),
            AttachmentStoreError::InvalidKey,
        );
    }

    store.remove(&key).await.expect("应删除已存附件");
    assert_eq!(
        store.read(&key).await.unwrap_err(),
        AttachmentStoreError::NotFound
    );
}

#[tokio::test]
#[cfg(unix)]
async fn store_rejects_symlink_escape_without_touching_outside_file() {
    use std::os::unix::fs::symlink;

    let root = tempfile::tempdir().expect("应创建 uploads 根目录");
    let outside = tempfile::tempdir().expect("应创建外部目录");
    let outside_file = outside.path().join("keep.webp");
    fs::write(&outside_file, b"keep").expect("应创建外部文件");
    let activity_segment = Uuid::new_v4().to_string();
    symlink(outside.path(), root.path().join(&activity_segment)).expect("应创建测试符号链接");
    let store = LocalAttachmentStore::new(root.path()).expect("合法根目录应可使用");
    let key = format!(
        "{}/{}/{}.webp",
        activity_segment,
        Uuid::new_v4(),
        Uuid::new_v4()
    );

    assert_eq!(
        store.write(&key, b"changed").await.unwrap_err(),
        AttachmentStoreError::InvalidKey,
    );
    assert_eq!(fs::read(outside_file).expect("外部文件仍应可读"), b"keep");
}

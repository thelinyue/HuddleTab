use axum::Router;
use std::path::Path;
use tower_http::services::{ServeDir, ServeFile};

/// `/assets` 使用独立服务以保留真实 404；其余非 API 路径才允许回退 SPA 入口。
pub fn mount_static_files(router: Router, static_dir: &Path) -> Router {
    let assets = ServeDir::new(static_dir.join("assets"));
    let spa = ServeDir::new(static_dir).fallback(ServeFile::new(static_dir.join("index.html")));

    router.nest_service("/assets", assets).fallback_service(spa)
}

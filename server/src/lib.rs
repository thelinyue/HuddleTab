pub mod application;
pub mod domain;
pub mod http;
pub mod infrastructure;

use axum::Router;
use http::router::AppState;
use std::path::Path;

/// 构造 HTTP 应用。后续所有跨层依赖都从这里显式注入，避免使用全局状态。
pub fn app() -> Router {
    http::router::router(None)
}

pub fn app_with_static_dir(static_dir: impl AsRef<Path>) -> Router {
    http::router::router(Some(static_dir.as_ref().to_path_buf()))
}

pub fn app_with_state_and_static_dir(state: AppState, static_dir: impl AsRef<Path>) -> Router {
    http::router::router_with_state(Some(static_dir.as_ref().to_path_buf()), state)
}

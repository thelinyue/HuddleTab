use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use std::{
    io,
    net::SocketAddr,
    path::{Path, PathBuf},
};

#[derive(Parser)]
#[command(name = "huddletab", version, about = "HuddleTab 应用服务")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// 启动 API 与前端静态文件服务。
    Serve {
        #[arg(long, default_value = "0.0.0.0:5660")]
        bind: SocketAddr,
        #[arg(long, default_value = "frontend/dist")]
        static_dir: PathBuf,
    },
    /// 在空数据库中创建首位用户。
    BootstrapUser {
        #[arg(long)]
        username: String,
        /// 从标准输入读取一行密码，供受保护的自动化部署使用。
        #[arg(long)]
        password_stdin: bool,
    },
    /// 从 Rust route 与 DTO 导出 `OpenAPI` contract。
    Openapi {
        #[arg(long)]
        output: PathBuf,
    },
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "huddletab_server=info".into()),
        )
        .init();

    match Cli::parse().command {
        Command::Serve { bind, static_dir } => serve(bind, static_dir).await,
        Command::BootstrapUser {
            username,
            password_stdin,
        } => bootstrap_user(username, password_stdin).await,
        Command::Openapi { output } => write_openapi(&output),
    }
}

async fn bootstrap_user(username: String, password_stdin: bool) -> anyhow::Result<()> {
    let password = if password_stdin {
        read_password_line()?
    } else {
        let password =
            rpassword::prompt_password("请输入首位用户密码：").context("无法从终端安全读取密码")?;
        let confirmation =
            rpassword::prompt_password("请再次输入密码：").context("无法从终端安全读取密码确认")?;
        if password != confirmation {
            bail!("两次输入的密码不一致，未创建用户");
        }
        password
    };

    let database_url =
        std::env::var("DATABASE_URL").context("缺少 DATABASE_URL，无法连接 HuddleTab 数据库")?;
    let pool =
        huddletab_server::infrastructure::database::connect_and_migrate(&database_url).await?;
    let created = huddletab_server::application::bootstrap_user::bootstrap_first_user(
        &pool,
        &huddletab_server::infrastructure::password::Argon2PasswordHasher,
        &huddletab_server::infrastructure::clock::SystemClock,
        huddletab_server::application::bootstrap_user::BootstrapUserInput { username, password },
    )
    .await?;
    println!("已创建首位用户：{} ({})", created.username, created.id);
    Ok(())
}

fn read_password_line() -> anyhow::Result<String> {
    let mut password = String::new();
    io::stdin()
        .read_line(&mut password)
        .context("无法从标准输入读取密码")?;
    if password.ends_with('\n') {
        password.pop();
        if password.ends_with('\r') {
            password.pop();
        }
    }
    Ok(password)
}

async fn serve(bind: SocketAddr, static_dir: PathBuf) -> anyhow::Result<()> {
    let database_url =
        std::env::var("DATABASE_URL").context("缺少 DATABASE_URL，无法连接 HuddleTab 数据库")?;
    let database =
        huddletab_server::infrastructure::database::connect_and_migrate(&database_url).await?;
    let data_dir =
        std::env::var_os("DATA_DIR").map_or_else(|| PathBuf::from("/data"), PathBuf::from);
    let app_secret = huddletab_server::infrastructure::app_secret::AppSecret::load_or_create(
        &data_dir.join("app-secret"),
    )
    .context("无法初始化持久化 app-secret，请检查 DATA_DIR 的所有权和权限")?;
    let base_origin =
        std::env::var("APP_BASE_URL").unwrap_or_else(|_| "http://localhost:5660".to_owned());
    let uploads_dir = data_dir.join("uploads");
    huddletab_server::infrastructure::attachment_cleanup::spawn_attachment_cleanup(
        database.clone(),
        uploads_dir.clone(),
    );
    let state = huddletab_server::http::router::AppState::new(database, app_secret, base_origin)
        .with_uploads_dir(uploads_dir);
    let listener = tokio::net::TcpListener::bind(bind)
        .await
        .with_context(|| format!("无法监听 {bind}，请检查端口是否被占用"))?;
    tracing::info!(address = %bind, static_dir = %static_dir.display(), "HuddleTab 服务已启动");
    axum::serve(
        listener,
        huddletab_server::app_with_state_and_static_dir(state, static_dir)
            .into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await
    .context("HuddleTab HTTP 服务异常退出")
}

fn write_openapi(output: &Path) -> anyhow::Result<()> {
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("无法创建 OpenAPI 输出目录：{}", parent.display()))?;
    }
    let contents = serde_json::to_string_pretty(&huddletab_server::http::openapi::document())
        .context("无法序列化 OpenAPI contract")?;
    std::fs::write(output, format!("{contents}\n"))
        .with_context(|| format!("无法写入 OpenAPI contract：{}", output.display()))?;
    Ok(())
}

async fn shutdown_signal() {
    if tokio::signal::ctrl_c().await.is_err() {
        tracing::error!("无法监听终止信号，服务将继续运行直至进程退出");
    }
}

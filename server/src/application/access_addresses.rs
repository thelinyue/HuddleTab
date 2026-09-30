//! 访问地址只表示 Origin，不承担路由、跳转或 DNS 可达性检查。
use url::Url;

/// 拒绝 URL 解析器会悄悄修复的输入，避免管理员保存的地址与实际保护范围不同。
///
/// # Errors
///
/// 输入不是合法的 HTTP 或 HTTPS Origin 时返回中文错误。
pub fn normalize_origin(value: &str) -> Result<String, &'static str> {
    let value = value.trim();
    if value.contains(['\\', '*']) || value.chars().any(char::is_control) {
        return Err("访问地址不能包含通配符、反斜杠或控制字符。");
    }
    let (_, remainder) = value
        .split_once("://")
        .ok_or("请填写完整的 HTTP 或 HTTPS 地址。")?;
    let authority = remainder.split(['/', '?', '#']).next().unwrap_or_default();
    let suffix = &remainder[authority.len()..];
    if authority.is_empty() || authority.contains(['@', '%']) || !matches!(suffix, "" | "/") {
        return Err("访问地址只能包含协议、主机和端口，不能包含路径、账号、查询参数或片段。");
    }
    let url = Url::parse(value).map_err(|_| "访问地址格式不正确。")?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err("请填写完整的 HTTP 或 HTTPS 地址。");
    }
    Ok(url.origin().ascii_serialization())
}

/// # Errors
///
/// 任一地址不是合法 Origin 时返回中文错误。
pub fn normalize_origins(values: &[String]) -> Result<Vec<String>, &'static str> {
    let mut origins = Vec::new();
    for value in values {
        let origin = normalize_origin(value)?;
        if !origins.contains(&origin) {
            origins.push(origin);
        }
    }
    Ok(origins)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_hosts_ports_ipv6_and_duplicates() {
        assert_eq!(
            normalize_origin(" HTTPS://Example.COM:443/ ").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_origin("http://[::1]:5660/").unwrap(),
            "http://[::1]:5660"
        );
        assert_eq!(
            normalize_origin("http://192.168.1.20:5660").unwrap(),
            "http://192.168.1.20:5660"
        );
        assert_eq!(
            normalize_origins(&["http://EXAMPLE.com:80".into(), "http://example.com/".into()])
                .unwrap(),
            vec!["http://example.com"]
        );
    }

    #[test]
    fn rejects_non_origin_urls_and_parser_repairs() {
        for input in [
            "",
            "example.com",
            "ftp://example.com",
            "http://*.example.com",
            "https://u:p@example.com",
            "https://@example.com",
            "http://example.com/a/..",
            "http://example.com/?q=1",
            "http://example.com/#x",
            "http://example.com\\",
            "http://exam\nple.com",
            "https:///example.com",
            "http://%65xample.com",
        ] {
            assert!(normalize_origin(input).is_err(), "{input:?}");
        }
    }
}

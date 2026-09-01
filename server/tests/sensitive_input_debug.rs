use huddletab_server::application::{
    auth::{ChangePasswordInput, LoginInput, RegisterInput},
    bootstrap_user::BootstrapUserInput,
    collaboration::JoinInput,
};
use uuid::Uuid;

#[test]
fn bootstrap_input_debug_redacts_password() {
    let rendered = format!(
        "{:?}",
        BootstrapUserInput {
            username: "alice".to_owned(),
            password: "bootstrap-secret".to_owned(),
        }
    );

    assert!(!rendered.contains("bootstrap-secret"));
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn login_input_debug_redacts_password() {
    let rendered = format!(
        "{:?}",
        LoginInput {
            username: "alice".to_owned(),
            password: "login-secret".to_owned(),
        }
    );

    assert!(!rendered.contains("login-secret"));
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn registration_input_debug_redacts_password_and_invitation_token() {
    let rendered = format!(
        "{:?}",
        RegisterInput {
            username: "alice".to_owned(),
            password: "registration-password-secret".to_owned(),
            display_name: "Alice".to_owned(),
            invitation_token: "registration-invitation-secret".to_owned(),
        }
    );

    assert!(!rendered.contains("registration-password-secret"));
    assert!(!rendered.contains("registration-invitation-secret"));
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn password_change_input_debug_redacts_both_passwords() {
    let rendered = format!(
        "{:?}",
        ChangePasswordInput {
            current_password: "current-password-secret".to_owned(),
            new_password: "new-password-secret".to_owned(),
        }
    );

    assert!(!rendered.contains("current-password-secret"));
    assert!(!rendered.contains("new-password-secret"));
    assert!(rendered.contains("[REDACTED]"));
}

#[test]
fn join_input_debug_redacts_raw_invitation_token() {
    let rendered = format!(
        "{:?}",
        JoinInput {
            raw_token: "join-invitation-secret".to_owned(),
            user_id: Uuid::nil(),
            username: "alice".to_owned(),
            display_name: "Alice".to_owned(),
        }
    );

    assert!(!rendered.contains("join-invitation-secret"));
    assert!(rendered.contains("[REDACTED]"));
}

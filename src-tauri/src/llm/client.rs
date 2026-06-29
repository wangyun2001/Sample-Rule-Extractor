use std::sync::OnceLock;
use std::time::Duration;

use reqwest::Client;

fn build_client() -> Client {
    Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(60))
        .build()
        .expect("failed to build reqwest Client")
}

/// Returns a shared, global reqwest::Client with connection pooling and timeouts.
///
/// - Connect timeout: 10 seconds
/// - Total request timeout: 60 seconds
/// - Connection pool is shared across all LLM calls
pub(crate) fn get_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(build_client)
}

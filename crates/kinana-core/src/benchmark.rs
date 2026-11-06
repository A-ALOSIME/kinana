use std::time::Instant;
use rand::{rngs::OsRng, RngCore};
use crate::crypto::{derive_key, Argon2Parameters};
use crate::error::VaultError;

#[derive(Debug, Clone)]
pub struct BenchmarkReport {
    pub tested_128mib_duration_ms: u128,
    pub tested_64mib_duration_ms: u128,
    pub recommended_params: Argon2Parameters,
    pub explanation: String,
}

/// Runs a real benchmark on the host machine to test Argon2id performance.
/// It measures derivation times for 128 MiB and 64 MiB (3 iterations, 4 threads),
/// and selects 128 MiB if the derivation takes <= 500ms for optimal desktop resistance against GPU brute-force.
pub fn benchmark_system_argon2() -> Result<BenchmarkReport, VaultError> {
    let mut salt = [0u8; 32];
    OsRng.fill_bytes(&mut salt);
    let test_pwd = "benchmark_probe_secret_password_do_not_use";

    // Test 128 MiB
    let params_128 = Argon2Parameters {
        m_cost: 128 * 1024, // 131,072 KiB
        t_cost: 3,
        p_cost: 4,
    };
    let start_128 = Instant::now();
    let _ = derive_key(test_pwd, &salt, &params_128)?;
    let duration_128_ms = start_128.elapsed().as_millis();

    // Test 64 MiB
    let params_64 = Argon2Parameters {
        m_cost: 64 * 1024, // 65,536 KiB
        t_cost: 3,
        p_cost: 4,
    };
    let start_64 = Instant::now();
    let _ = derive_key(test_pwd, &salt, &params_64)?;
    let duration_64_ms = start_64.elapsed().as_millis();

    let (recommended_params, explanation) = if duration_128_ms <= 500 {
        (
            params_128,
            format!(
                "Host CPU completed 128 MiB derivation in {}ms (<= 500ms). Selected high-defense 128 MiB parameters.",
                duration_128_ms
            ),
        )
    } else {
        (
            params_64,
            format!(
                "Host CPU completed 128 MiB in {}ms (> 500ms). Fell back to 64 MiB ({}ms) to maintain smooth UI experience.",
                duration_128_ms, duration_64_ms
            ),
        )
    };

    Ok(BenchmarkReport {
        tested_128mib_duration_ms: duration_128_ms,
        tested_64mib_duration_ms: duration_64_ms,
        recommended_params,
        explanation,
    })
}

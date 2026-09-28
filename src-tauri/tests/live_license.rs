//! LIVE end-to-end license integration test (runs ONLY when the
//! `live-license-e2e` cargo feature is enabled — never in the normal
//! `cargo test` pass, never in NSIS/MSIX production builds):
//!
//!   --features live-license-e2e
//!   DISKBYTES_LIVE_LICENSE_E2E=1
//!   DISKBYTES_LIVE_ADMIN_KEY=<admin bearer>
//!   DISKBYTES_LICENSE_API=https://…workers.dev/   (optional; defaults
//!   to the compiled-in production base)
//!
//! Executed by `.github/workflows/license-e2e.yml` on the Windows
//! runner against the REAL deployed worker: generate a key via the
//! admin API → activate with the FULL v2 device claim → locally verify
//! the Ed25519 token against the production public key → revalidate
//! with CHANGED facts → admin-lookup and assert the device row kept
//! them (the v1 wipe regression, LIVE) → assert the slot rule →
//! deactivate → assert the slot freed → revoke the key (cleanup;
//! tier=yearly&days=1 means even a failed cleanup self-expires).
//!
//! Nothing here touches a real customer key: every run mints its own.

#![cfg(feature = "live-license-e2e")]

use diskbytes::license::{
    DeviceFacts, EntitlementDto, LicenseApi, LicenseError, ReqwestLicense, LICENSE_PUBLIC_KEY_HEX,
    LICENSE_PURCHASE_URL, VALIDATION_INTERVAL_S,
};

const ADMIN_KEY: Option<&str> = option_env!("DISKBYTES_LIVE_ADMIN_KEY");
const LIVE: bool = option_env!("DISKBYTES_LIVE_LICENSE_E2E").is_some();

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| i64::try_from(d.as_secs()).unwrap_or(0))
        .unwrap_or(0)
}

fn live_base() -> String {
    std::env::var("DISKBYTES_LICENSE_API").unwrap_or_else(|_| diskbytes::license::api_base())
}

/// Minimal admin HTTP (plain bearer JSON — no HMAC on admin routes).
struct AdminHttp {
    client: reqwest::blocking::Client,
    base: String,
}

impl AdminHttp {
    fn new() -> Result<Self, String> {
        Ok(Self {
            client: reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|e| format!("admin client: {e}"))?,
            base: live_base().trim_end_matches('/').to_string(),
        })
    }

    fn post<T: serde::de::DeserializeOwned>(&self, path: &str, body: &str) -> Result<T, String> {
        let resp = self
            .client
            .post(format!("{}{path}", self.base))
            .header("authorization", format!("Bearer {}", ADMIN_KEY.unwrap_or_default()))
            .header("content-type", "application/json")
            .body(body.to_string())
            .send()
            .map_err(|e| format!("admin post: {e}"))?;
        let status = resp.status().as_u16();
        let text = resp.text().map_err(|e| format!("admin read: {e}"))?;
        if !(200..300).contains(&status) {
            return Err(format!("admin {path} -> {status}: {text}"));
        }
        serde_json::from_str(&text).map_err(|e| format!("admin parse: {e}"))
    }
}

#[derive(serde::Deserialize)]
struct GenKeyResponse {
    #[allow(dead_code)]
    ok: bool,
    keys: Vec<GenKey>,
}

#[derive(serde::Deserialize)]
struct GenKey {
    key: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupResponse {
    license: LookupLicense,
    devices: Vec<LookupDevice>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupLicense {
    id: i64,
    customer_email: String,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LookupDevice {
    hardware_hash: String,
    hostname: Option<String>,
    os_version: Option<String>,
    app_version: Option<String>,
    ram_mb: Option<u64>,
    machine_model: Option<String>,
    revoked: bool,
}

/// The synthetic-but-realistic device for this run (fresh hw per run —
/// sha256 of the epoch-second, so reruns never collide on slots).
fn run_facts(tag: &str) -> DeviceFacts {
    let hw = diskbytes::license::sha256_hex(&format!("live-e2e-{tag}-{}", now_unix()));
    DeviceFacts {
        platform: "windows".to_string(),
        hardware_hash: hw,
        hostname: format!("E2E-{tag}"),
        os_version: "Windows 11.0.26100".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        comp_machine: Some(diskbytes::license::sha256_hex("live-e2e-machine")),
        comp_volume: Some(diskbytes::license::sha256_hex("live-e2e-volume")),
        comp_cpu: Some(diskbytes::license::sha256_hex("live-e2e-cpu")),
        cpu_brand: Some("Intel(R) Core(TM) i7-1260P CPU @ 2.10GHz".to_string()),
        ram_mb: Some(16_384),
        machine_model: Some("E2E Runner Co. License Test Rig".to_string()),
    }
}

fn api() -> Result<LicenseApi<ReqwestLicense>, String> {
    Ok(LicenseApi::new(ReqwestLicense::new()?))
}

/// Verify a returned token with the production public key + the run's
/// fingerprint — the same call the command layer makes before trusting.
fn verify(dto: &EntitlementDto, key: &str, facts: &DeviceFacts) -> Result<(), String> {
    let claims = diskbytes::license::verify_token(
        &dto.token,
        LICENSE_PUBLIC_KEY_HEX,
        &diskbytes::license::sha256_hex(key),
        &facts.hardware_hash,
        &facts.platform,
        now_unix(),
    )
    .map_err(|e| format!("token verification failed: {e}"))?;
    assert_eq!(claims.plat, "windows");
    Ok(())
}

#[test]
fn live_license_lifecycle_keeps_device_facts() {
    if !LIVE || ADMIN_KEY.is_none() {
        panic!("live-license-e2e feature enabled but DISKBYTES_LIVE_LICENSE_E2E / DISKBYTES_LIVE_ADMIN_KEY not set");
    }
    let admin = AdminHttp::new().expect("admin client");

    // 1. Mint a throwaway yearly key (days=1 → self-expires even if a
    //    later step fails; note tags it as CI).
    let gen: GenKeyResponse = admin
        .post(
            "/v1/admin/keys",
            &serde_json::json!({
                "tier": "yearly",
                "customerName": "E2E Bot",
                "customerEmail": "e2e@diskbytes.test",
                "days": 1,
                "note": "ci live e2e",
                "source": "webhook",
            })
            .to_string(),
        )
        .expect("generate key");
    let key = &gen.keys[0].key;
    println!("[e2e] generated key ending …{}", &key[key.len() - 4..]);

    // 2. Activate with the FULL v2 claim.
    let facts = run_facts("A");
    let dto = api().expect("api").activate(key, &facts).expect("activate");
    verify(&dto, key, &facts).expect("verify activation token");
    println!("[e2e] activated; token verified against the production public key");

    // 3. Admin lookup — the device row carries every fact.
    let look: LookupResponse = admin
        .post("/v1/admin/lookup", &serde_json::json!({ "key": key }).to_string())
        .expect("lookup");
    assert_eq!(look.license.customer_email, "e2e@diskbytes.test");
    let dev = look
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts.hardware_hash)
        .expect("device row");
    assert_eq!(dev.hostname.as_deref(), Some("E2E-A"));
    assert_eq!(dev.os_version.as_deref(), Some("Windows 11.0.26100"));
    assert_eq!(dev.ram_mb, Some(16_384));
    assert!(dev.machine_model.as_deref().is_some_and(|m| m.contains("Test Rig")));
    println!("[e2e] activation stored the full device facts");

    // 4. Revalidate with CHANGED facts (OS bump + app bump — exactly
    //    what a real user's 24 h revalidation looks like after an
    //    update). v1 WIPED the row here; v2 must refresh it.
    let mut bumped = run_facts("A");
    bumped.os_version = "Windows 11.0.27842".to_string();
    bumped.app_version = "0.2.0".to_string();
    let dto2 = api().expect("api").validate(key, &bumped).expect("validate");
    verify(&dto2, key, &bumped).expect("verify revalidation token");

    let look2: LookupResponse = admin
        .post("/v1/admin/lookup", &serde_json::json!({ "key": key }).to_string())
        .expect("lookup 2");
    let dev2 = look2
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts.hardware_hash)
        .expect("device row 2");
    assert_eq!(
        dev2.hostname.as_deref(),
        Some("E2E-A"),
        "hostname must survive revalidation"
    );
    assert_eq!(
        dev2.os_version.as_deref(),
        Some("Windows 11.0.27842"),
        "os_version must REFRESH on revalidation (the v1 wipe regression)"
    );
    assert_eq!(dev2.app_version.as_deref(), Some("0.2.0"));
    assert_eq!(dev2.ram_mb, Some(16_384));
    println!("[e2e] revalidation refreshed facts — the v1 wipe bug is fixed on the live worker");

    // 5. Slot rule: a second device on the same platform is refused.
    let other = run_facts("B");
    let err = api().expect("api").activate(key, &other).expect_err("slot must be taken");
    assert!(
        matches!(err, LicenseError::DeviceSlotTaken),
        "expected DeviceSlotTaken, got {err:?}"
    );
    println!("[e2e] second Windows device refused (DEVICE_SLOT_TAKEN)");

    // 6. Deactivate frees the slot; the other device can now register.
    api().expect("api").deactivate(key, &facts).expect("deactivate");
    let look3: LookupResponse = admin
        .post("/v1/admin/lookup", &serde_json::json!({ "key": key }).to_string())
        .expect("lookup 3");
    let dev3 = look3
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts.hardware_hash)
        .expect("device row 3");
    assert!(dev3.revoked, "device row revoked after deactivate");
    let dto3 = api().expect("api").activate(key, &other).expect("activate after free");
    verify(&dto3, key, &other).expect("verify second activation");
    println!("[e2e] slot freed → re-registered on the new hardware");

    // 7. Cleanup: revoke the license; validation must now hard-fail.
    let _ = admin.post(&format!("/v1/admin/keys/{}/revoke", look.license.id), "{}");
    let err2 = api().expect("api").validate(key, &other).expect_err("revoked must hard-fail");
    assert!(
        matches!(err2, LicenseError::Inactive),
        "expected KEY_REVOKED -> Inactive, got {err2:?}"
    );
    println!("[e2e] cleanup: license revoked + validation hard-fails — live E2E PASS");

    // Compile-time pins so the workflow notices drift immediately.
    assert_eq!(VALIDATION_INTERVAL_S, 24 * 60 * 60);
    assert!(LICENSE_PURCHASE_URL.starts_with("https://"));
    assert!(live_base().starts_with("https://"));
}

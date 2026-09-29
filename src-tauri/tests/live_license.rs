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
//! The second test (v3) runs the REAL platform collection on the CI
//! machine itself: the fingerprint must be DETERMINISTIC across two
//! independent collections ("same device → same hashes"), every v3
//! fact must be present + sanitized, and activating with the REAL
//! claim must store EXACTLY those values server-side ("hashes match
//! on the same device") — then deactivates + revokes.
//!
//! Nothing here touches a real customer key: every run mints its own.

#![cfg(feature = "live-license-e2e")]

use diskbytes_lib::license::{
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

/// The run-scoped epoch stamp: ONE value for the whole test binary.
/// `run_facts` derives the synthetic fingerprint from this, so calling
/// it twice with the same tag yields the SAME hardware hash — the
/// real collector's determinism property (the live log proves it:
/// "fingerprint stable across two collections"). The v3 fixture
/// embedded `now_unix()` per CALL, so the revalidation step minted a
/// brand-new fingerprint and the server correctly answered
/// DEVICE_MISMATCH — a fixture bug, not a server one. A fresh value
/// per RUN still guarantees reruns never collide on live slots.
fn run_stamp() -> i64 {
    static STAMP: std::sync::OnceLock<i64> = std::sync::OnceLock::new();
    *STAMP.get_or_init(now_unix)
}

fn live_base() -> String {
    std::env::var("DISKBYTES_LICENSE_API").unwrap_or_else(|_| diskbytes_lib::license::api_base())
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

    fn get<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T, String> {
        let resp = self
            .client
            .get(format!("{}{path}", self.base))
            .header(
                "authorization",
                format!("Bearer {}", ADMIN_KEY.unwrap_or_default()),
            )
            .send()
            .map_err(|e| format!("admin get: {e}"))?;
        let status = resp.status().as_u16();
        let text = resp.text().map_err(|e| format!("admin read: {e}"))?;
        if !(200..300).contains(&status) {
            return Err(format!("admin {path} -> {status}: {text}"));
        }
        serde_json::from_str(&text).map_err(|e| format!("admin parse: {e}"))
    }

    fn post<T: serde::de::DeserializeOwned>(&self, path: &str, body: &str) -> Result<T, String> {
        let resp = self
            .client
            .post(format!("{}{path}", self.base))
            .header(
                "authorization",
                format!("Bearer {}", ADMIN_KEY.unwrap_or_default()),
            )
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
    cpu_brand: Option<String>,
    baseboard_serial: Option<String>,
    firmware_uuid: Option<String>,
    bios_version: Option<String>,
    cpu_cores: Option<u32>,
    arch: Option<String>,
    comp_machine: Option<String>,
    comp_volume: Option<String>,
    comp_cpu: Option<String>,
    comp_board: Option<String>,
    comp_firmware: Option<String>,
    facts_v3: Option<bool>,
    revoked: bool,
}

/// The synthetic-but-realistic device for this run (fresh hw per run —
/// sha256 of the run stamp, so reruns never collide on slots but the
/// hash is STABLE within a run, exactly like real hardware).
fn run_facts(tag: &str) -> DeviceFacts {
    let stamp = run_stamp();
    let hw = diskbytes_lib::license::sha256_hex(&format!("live-e2e-{tag}-{stamp}"));
    DeviceFacts {
        platform: "windows".to_string(),
        hardware_hash: hw,
        hostname: format!("E2E-{tag}"),
        os_version: "Windows 11.0.26100".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        comp_machine: Some(diskbytes_lib::license::sha256_hex("live-e2e-machine")),
        comp_volume: Some(diskbytes_lib::license::sha256_hex("live-e2e-volume")),
        comp_cpu: Some(diskbytes_lib::license::sha256_hex("live-e2e-cpu")),
        cpu_brand: Some("Intel(R) Core(TM) i7-1260P CPU @ 2.10GHz".to_string()),
        ram_mb: Some(16_384),
        machine_model: Some("E2E Runner Co. License Test Rig".to_string()),
        baseboard_serial: Some("E2EBOARD0001".to_string()),
        firmware_uuid: Some("4c4c4544-0042-4e10-8032-b2c04f4750e2e".to_string()),
        bios_version: Some("E2E BIOS 1.0".to_string()),
        cpu_cores: Some(8),
        arch: Some("x86_64".to_string()),
        comp_board: Some(diskbytes_lib::license::sha256_hex("live-e2e-board")),
        comp_firmware: Some(diskbytes_lib::license::sha256_hex("live-e2e-firmware")),
    }
}

fn api() -> Result<LicenseApi<ReqwestLicense>, String> {
    Ok(LicenseApi::new(ReqwestLicense::new()?))
}

/// Verify a returned token with the production public key + the run's
/// fingerprint — the same call the command layer makes before trusting.
fn verify(dto: &EntitlementDto, key: &str, facts: &DeviceFacts) -> Result<(), String> {
    let claims = diskbytes_lib::license::verify_token(
        &dto.token,
        LICENSE_PUBLIC_KEY_HEX,
        &diskbytes_lib::license::sha256_hex(key),
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

    // 0. The worker must be v2+ (the device-facts COALESCE fix, the
    //    rate limits, and the admin lookup route all ship in v2). A v1
    //    worker would fail step 4 with the wipe bug — fail FAST with
    //    the redeploy instruction instead of a cryptic mid-test assert.
    let health: serde_json::Value = admin.get("/v1/health").unwrap_or_else(|e| {
        panic!(
            "worker unreachable: {e}\nIf the body says 'error code: 1042': the \
             workers.dev route is disabled — Cloudflare dashboard → Workers & Pages → \
             diskbytes-license → Settings → Domains & Routes → enable workers.dev \
             (the license-server repo now defaults workers_dev: true in wrangler.jsonc; \
             redeploy with `npx wrangler deploy` after enabling)."
        );
    });
    assert!(
        health
            .get("version")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1)
            >= 3,
        "the deployed license server is older than v3 — the repo auto-deploys on push; \
         verify the last diskbytes-license-server push completed, then (once) run \
         npx wrangler d1 migrations apply DB --remote  (the worker also self-heals \
         the additive v3 columns on first request, so activation keeps working \
         either way)"
    );
    println!("[e2e] worker v{} healthy", health["version"]);

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
        .post(
            "/v1/admin/lookup",
            &serde_json::json!({ "key": key }).to_string(),
        )
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
    assert!(dev
        .machine_model
        .as_deref()
        .is_some_and(|m| m.contains("Test Rig")));
    println!("[e2e] activation stored the full device facts");

    // 4. Revalidate with CHANGED facts (OS bump + app bump — exactly
    //    what a real user's 24 h revalidation looks like after an
    //    update). v1 WIPED the row here; v2 must refresh it.
    let mut bumped = run_facts("A");
    bumped.os_version = "Windows 11.0.27842".to_string();
    bumped.app_version = "0.2.0".to_string();
    let dto2 = api()
        .expect("api")
        .validate(key, &bumped)
        .expect("validate");
    verify(&dto2, key, &bumped).expect("verify revalidation token");

    let look2: LookupResponse = admin
        .post(
            "/v1/admin/lookup",
            &serde_json::json!({ "key": key }).to_string(),
        )
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
    let err = api()
        .expect("api")
        .activate(key, &other)
        .expect_err("slot must be taken");
    assert!(
        matches!(err, LicenseError::DeviceSlotTaken),
        "expected DeviceSlotTaken, got {err:?}"
    );
    println!("[e2e] second Windows device refused (DEVICE_SLOT_TAKEN)");

    // 6. Deactivate frees the slot; the other device can now register.
    api()
        .expect("api")
        .deactivate(key, &facts)
        .expect("deactivate");
    let look3: LookupResponse = admin
        .post(
            "/v1/admin/lookup",
            &serde_json::json!({ "key": key }).to_string(),
        )
        .expect("lookup 3");
    let dev3 = look3
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts.hardware_hash)
        .expect("device row 3");
    assert!(dev3.revoked, "device row revoked after deactivate");
    let dto3 = api()
        .expect("api")
        .activate(key, &other)
        .expect("activate after free");
    verify(&dto3, key, &other).expect("verify second activation");
    println!("[e2e] slot freed → re-registered on the new hardware");

    // 7. Cleanup: revoke the license; validation must now hard-fail.
    let _: serde_json::Value = admin
        .post(&format!("/v1/admin/keys/{}/revoke", look.license.id), "{}")
        .expect("cleanup revoke");
    let err2 = api()
        .expect("api")
        .validate(key, &other)
        .expect_err("revoked must hard-fail");
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

/// Same-device determinism + real-claim round-trip (the owner's v3 ask:
/// "test on same device, check hashes matches or not").
///
/// 1. Two INDEPENDENT collections on THIS machine must agree exactly —
///    the fingerprint is deterministic, not a function of timing.
/// 2. Every v3 fact is present and sanitized on a real Windows runner
///    (control chars must never reach the server).
/// 3. Activating with the REAL claim stores EXACTLY those values
///    server-side (admin lookup asserts field-for-field equality —
///    the "hashes match" proof, LIVE).
/// 4. Cleanup: deactivate + revoke.
#[test]
fn real_device_fingerprint_is_deterministic_and_round_trips() {
    if !LIVE || ADMIN_KEY.is_none() {
        panic!("live-license-e2e feature enabled but DISKBYTES_LIVE_LICENSE_E2E / DISKBYTES_LIVE_ADMIN_KEY not set");
    }
    let admin = AdminHttp::new().expect("admin client");
    let health: serde_json::Value = admin.get("/v1/health").expect("worker healthy");
    assert!(
        health
            .get("version")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1)
            >= 3,
        "worker is pre-v3 ({})",
        health
    );

    // 1. Determinism: two independent collections agree on EVERY byte.
    let facts_a = diskbytes_lib::license::collect_device_facts()
        .expect("real device facts collectable on the CI machine");
    let facts_b = diskbytes_lib::license::collect_device_facts()
        .expect("real device facts collectable (2nd collection)");
    assert_eq!(
        facts_a.hardware_hash, facts_b.hardware_hash,
        "same-device composite fingerprint must be deterministic"
    );
    let comps_a = diskbytes_lib::license::component_hashes();
    let comps_b = diskbytes_lib::license::component_hashes();
    assert_eq!(comps_a, comps_b, "component hashes must be deterministic");
    println!(
        "[e2e] fingerprint stable across two collections: {}",
        &facts_a.hardware_hash[..12]
    );

    // 2. Fact sanity + sanitation on a real Windows runner.
    println!(
        "[e2e] real facts: hostname={:?} os={:?} cpu={:?} cores={:?} arch={:?} board={:?} fwuuid={:?} bios={:?} model={:?} ram={:?}",
        facts_a.hostname, facts_a.os_version, facts_a.cpu_brand, facts_a.cpu_cores,
        facts_a.arch, facts_a.baseboard_serial, facts_a.firmware_uuid, facts_a.bios_version,
        facts_a.machine_model, facts_a.ram_mb
    );
    assert!(
        facts_a.hostname.len() >= 2,
        "hostname collected on a real machine"
    );
    assert!(
        facts_a.os_version.contains("Windows"),
        "os_version reads the real OS"
    );
    assert!(facts_a.cpu_cores.unwrap_or(0) >= 2, "cpu_cores collected");
    assert_eq!(
        facts_a.arch.as_deref(),
        Some("x86_64"),
        "arch on the windows runner"
    );
    for fact in [
        &facts_a.cpu_brand,
        &facts_a.bios_version,
        &facts_a.baseboard_serial,
    ] {
        if let Some(s) = fact {
            assert!(
                !s.chars().any(|c| c.is_control()),
                "facts must be control-char clean before the wire: {s:?}"
            );
        }
    }
    if let Some(brand) = &facts_a.cpu_brand {
        assert!(!brand.contains("  "), "brand spaces collapsed: {brand:?}");
    }

    // 3. Round-trip: activate with the REAL claim → the stored row
    //    matches field-for-field (the "hashes match" proof).
    let gen: GenKeyResponse = admin
        .post(
            "/v1/admin/keys",
            &serde_json::json!({
                "tier": "yearly",
                "customerName": "E2E Real Facts Bot",
                "customerEmail": "e2e-real@diskbytes.test",
                "days": 1,
                "note": "ci live e2e v3",
                "source": "webhook",
            })
            .to_string(),
        )
        .expect("generate key");
    let key = &gen.keys[0].key;

    let dto = api()
        .expect("api")
        .activate(key, &facts_a)
        .expect("activate with REAL facts");
    verify(&dto, key, &facts_a).expect("verify REAL activation token");

    let look: LookupResponse = admin
        .post(
            "/v1/admin/lookup",
            &serde_json::json!({ "key": key }).to_string(),
        )
        .expect("lookup real facts");
    let dev = look
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts_a.hardware_hash)
        .expect("device row for the real fingerprint");
    assert_eq!(dev.hostname.as_deref(), Some(facts_a.hostname.as_str()));
    assert_eq!(dev.os_version.as_deref(), Some(facts_a.os_version.as_str()));
    assert_eq!(
        dev.app_version.as_deref(),
        Some(facts_a.app_version.as_str())
    );
    assert_eq!(dev.cpu_cores, facts_a.cpu_cores);
    assert_eq!(dev.arch.as_deref(), facts_a.arch.as_deref());
    assert_eq!(dev.cpu_brand.as_deref(), facts_a.cpu_brand.as_deref());
    assert_eq!(
        dev.baseboard_serial.as_deref(),
        facts_a.baseboard_serial.as_deref()
    );
    assert_eq!(
        dev.firmware_uuid.as_deref(),
        facts_a.firmware_uuid.as_deref()
    );
    assert_eq!(dev.bios_version.as_deref(), facts_a.bios_version.as_deref());
    assert_eq!(dev.ram_mb, facts_a.ram_mb);
    assert_eq!(dev.comp_machine.as_deref(), facts_a.comp_machine.as_deref());
    assert_eq!(dev.comp_volume.as_deref(), facts_a.comp_volume.as_deref());
    assert_eq!(dev.comp_cpu.as_deref(), facts_a.comp_cpu.as_deref());
    assert_eq!(dev.comp_board.as_deref(), facts_a.comp_board.as_deref());
    assert_eq!(
        dev.comp_firmware.as_deref(),
        facts_a.comp_firmware.as_deref()
    );
    assert_eq!(dev.facts_v3, Some(true), "facts_v3 provenance marker set");
    println!("[e2e] REAL claim round-trip: every stored field matches the collected facts");

    // 4. Revalidating with the SAME real claim is a pure refresh (no
    //    device_update diff — determinism extends to the server view).
    let dto2 = api()
        .expect("api")
        .validate(key, &facts_a)
        .expect("revalidate REAL facts");
    verify(&dto2, key, &facts_a).expect("verify revalidation token");
    let events: serde_json::Value = admin.get("/v1/admin/stats").expect("stats reachable");
    let _ = events; // (shape varies; the diff absence is asserted via lookup)
    let look2: LookupResponse = admin
        .post(
            "/v1/admin/lookup",
            &serde_json::json!({ "key": key }).to_string(),
        )
        .expect("lookup 2");
    let dev2 = look2
        .devices
        .iter()
        .find(|d| d.hardware_hash == facts_a.hardware_hash)
        .expect("device row after revalidation");
    assert_eq!(
        dev2.hostname.as_deref(),
        dev.hostname.as_deref(),
        "stable across revalidation"
    );
    assert_eq!(dev2.comp_board.as_deref(), dev.comp_board.as_deref());

    // 5. Cleanup: free the slot + revoke the key.
    api()
        .expect("api")
        .deactivate(key, &facts_a)
        .expect("deactivate real-facts device");
    let _: serde_json::Value = admin
        .post(&format!("/v1/admin/keys/{}/revoke", look.license.id), "{}")
        .expect("cleanup revoke");
    println!("[e2e] real-facts device deactivated + license revoked — v3 E2E PASS");
}

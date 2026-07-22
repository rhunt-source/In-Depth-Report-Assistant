use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Deserialize)]
struct PbFetchRequest {
    url: String,
    method: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
}

#[derive(Serialize)]
struct PbFetchResponse {
    ok: bool,
    status: u16,
    status_text: String,
    headers: HashMap<String, String>,
    body: String,
}

#[tauri::command]
async fn pb_fetch(request: PbFetchRequest) -> Result<PbFetchResponse, String> {
    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(false)
        .build()
        .map_err(|e| e.to_string())?;

    let method = match request.method.to_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        "DELETE" => reqwest::Method::DELETE,
        "HEAD" => reqwest::Method::HEAD,
        "OPTIONS" => reqwest::Method::OPTIONS,
        _ => return Err(format!("Unsupported method: {}", request.method)),
    };

    let mut req = client.request(method, &request.url);

    if let Some(headers) = request.headers {
        for (k, v) in headers {
            req = req.header(&k, &v);
        }
    }

    if let Some(body) = request.body {
        req = req.header("Content-Type", "application/json");
        req = req.body(body);
    }

    let response = req.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let status_text = response.status().canonical_reason().unwrap_or("Unknown").to_string();

    let mut resp_headers = HashMap::new();
    for (k, v) in response.headers() {
        if let Ok(val) = v.to_str() {
            resp_headers.insert(k.to_string(), val.to_string());
        }
    }

    let body_text = response.text().await.map_err(|e| e.to_string())?;

    Ok(PbFetchResponse {
        ok: status >= 200 && status < 300,
        status,
        status_text,
        headers: resp_headers,
        body: body_text,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![greet, pb_fetch])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

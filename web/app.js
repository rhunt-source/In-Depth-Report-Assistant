// ==========================================
// TAURI-SPECIFIC CODE (no bundler / no ES imports)
// Uses window.__TAURI__ globals injected by Tauri runtime.
// ==========================================

// Intercept PocketBase fetch calls through Rust backend
// (workaround for WebView2 SSL issues on corporate networks)
(function() {
    var _origFetch = window.fetch;
    var PB_HOST = 'in-depth.ca';
    window.fetch = async function(url, opts) {
        var urlStr = (typeof url === 'string') ? url : (url && url.url) || '';
        if (urlStr.indexOf(PB_HOST) !== -1 && window.__TAURI__ && window.__TAURI__.core) {
            try {
                var headers = {};
                if (opts && opts.headers) {
                    if (opts.headers instanceof Headers) {
                        opts.headers.forEach(function(v, k) { headers[k] = v; });
                    } else if (typeof opts.headers === 'object') {
                        for (var k in opts.headers) headers[k] = opts.headers[k];
                    }
                }
                var body = null;
                if (opts && opts.body) {
                    if (typeof opts.body === 'string') body = opts.body;
                    else if (opts.body instanceof URLSearchParams) body = opts.body.toString();
                    else if (typeof FormData !== 'undefined' && opts.body instanceof FormData) {
                        var obj = {};
                        opts.body.forEach(function(v, k) { obj[k] = v; });
                        body = JSON.stringify(obj);
                        if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
                    }
                }
                var result = await window.__TAURI__.core.invoke('pb_fetch', {
                    request: {
                        url: urlStr,
                        method: (opts && opts.method) || 'GET',
                        headers: headers,
                        body: body
                    }
                });
                var respHeaders = new Headers();
                if (result.headers) {
                    for (var hk in result.headers) respHeaders.set(hk, result.headers[hk]);
                }
                return new Response(result.body, {
                    status: result.status,
                    statusText: result.status_text,
                    headers: respHeaders
                });
            } catch (e) {
                console.error('[PB] Rust fetch proxy failed:', e);
                throw e;
            }
        }
        return _origFetch.apply(this, arguments);
    };
})();

// ==========================================
// SUBMIT REPORT (needs Tauri FS)
// ==========================================
window.submitReport = async function() {
    try {
        const table = document.getElementById('report-table');
        if (!table) {
            window.__TAURI__.dialog.message('Could not find the report table to export.', { title: 'Error', kind: 'error' });
            return;
        }

        const wb = XLSX.utils.table_to_book(table);
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        const dateString = new Date().toISOString().split('T')[0];
        const fileName = `LRP_Report_${dateString}.xlsx`;
        const filePath = `Z:\\JHSSHARE\\LRP Monthly Reports\\${fileName}`;

        await window.__TAURI__.fs.writeBinaryFile(filePath, new Uint8Array(wbout));
        await window.__TAURI__.dialog.message(`Report successfully saved to:\n${filePath}`, { title: 'Success', kind: 'info' });

    } catch (error) {
        console.error('Failed to save the report:', error);
        window.__TAURI__.dialog.message('Could not save the report. Please check your connection to the Z: drive.', { title: 'Save Failed', kind: 'error' });
    }
};

// ==========================================
// TAURI UPDATER
// ==========================================
function showToast(text, duration) {
    duration = duration || 4000;
    const toast = document.createElement('div');
    toast.textContent = text;
    Object.assign(toast.style, {
        position: 'fixed', bottom: '24px', right: '24px', zIndex: '100000',
        background: 'var(--accent)', color: '#fff', padding: '12px 20px',
        borderRadius: '8px', fontSize: '13px', fontWeight: '600',
        boxShadow: '0 4px 16px rgba(0,0,0,.3)', opacity: '0',
        transition: 'opacity .3s ease', maxWidth: '400px', textAlign: 'center'
    });
    document.body.appendChild(toast);
    requestAnimationFrame(function() { toast.style.opacity = '1'; });
    setTimeout(function() {
        toast.style.opacity = '0';
        setTimeout(function() { toast.remove(); }, 400);
    }, duration);
}

async function handleUpdateDownload(update) {
    var confirmed = await window.__TAURI__.dialog.message(
        'Version ' + update.version + ' is available.\n\nDo you want to download and install the update? The app will restart automatically.',
        { title: 'Update Available', kind: 'info' }
    );
    if (!confirmed) return;
    await update.downloadAndInstall();
    await window.__TAURI__.core.invoke('plugin:process|relaunch');
}

async function checkForTauriUpdate() {
    try {
        var updater = window.__TAURI__.updater;
        if (!updater) {
            await window.__TAURI__.dialog.message('Auto-updater is not available.', { title: 'Update Check Failed', kind: 'error' });
            return;
        }
        var update = await updater.check();
        if (update) {
            await handleUpdateDownload(update);
        } else {
            await window.__TAURI__.dialog.message('You are running the latest version.', { title: 'Up to Date', kind: 'info' });
        }
    } catch (e) {
        console.error('Update check failed:', e);
        await window.__TAURI__.dialog.message('Could not check for updates. Please check your internet connection.', { title: 'Update Check Failed', kind: 'error' });
    }
}
window.checkForTauriUpdate = checkForTauriUpdate;

async function autoCheckForUpdate() {
    try {
        var updater = window.__TAURI__.updater;
        if (!updater) return;
        var update = await updater.check();
        if (update) {
            await update.downloadAndInstall();
            showToast('Update to v' + update.version + ' installed. Restarting...', 3000);
            await new Promise(function(r) { setTimeout(r, 2500); });
            await window.__TAURI__.core.invoke('plugin:process|relaunch');
        }
    } catch (e) {
        console.error('Auto-update check failed:', e);
    }
}

// Auto-check on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoCheckForUpdate);
} else {
    autoCheckForUpdate();
}

// ==========================================
// POCKETBASE INIT + AUTH
// ==========================================
var PB_URL_DEFAULT = 'https://in-depth.ca';
var pb = null;

function getPbUrl() {
    return PB_URL_DEFAULT;
}

function initPocketBase(url) {
    if (!url) return false;
    try {
        pb = new PocketBase(url);
        pb.autoCancellation(false);
        return true;
    } catch (e) {
        console.error('PocketBase init failed:', e);
        return false;
    }
}

function updateConnStatus(state) {
    var dot = document.getElementById('connDot');
    var label = document.getElementById('connLabel');
    if (!dot || !label) return;
    dot.className = 'conn-indicator';
    if (state === 'ok') { dot.classList.add('conn-ok'); label.textContent = 'Connected'; }
    else if (state === 'off') { dot.classList.add('conn-off'); label.textContent = 'Offline'; }
    else { dot.classList.add('conn-err'); label.textContent = 'Error'; }
}

async function pbLogin() {
    var email = (document.getElementById('loginEmail').value || '').trim();
    var password = document.getElementById('loginPassword').value || '';
    var errorEl = document.getElementById('loginError');
    var btn = document.getElementById('loginBtn');

    if (!email || !password) {
        errorEl.textContent = 'Please enter email and password.';
        return;
    }

    var urlInput = document.getElementById('loginUrlInput');
    var url = PB_URL_DEFAULT;
    localStorage.removeItem('pbUrl');
    if (!url) {
        errorEl.textContent = 'Please enter a server URL.';
        var urlRow = document.getElementById('loginUrlRow');
        if (urlRow) urlRow.style.display = '';
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="login-spinner"></span>Signing in...';
    errorEl.textContent = '';

    try {
        if (!pb || (pb && pb.baseUrl !== url)) initPocketBase(url);
        var authData = await pb.collection('users').authWithPassword(email, password);
        localStorage.setItem('staffName', authData.record.name || email);
        localStorage.setItem('pbEmail', email);
        localStorage.setItem('pbUrl', url);
        updateConnStatus('ok');
        hideLoginScreen();
        if (typeof initApp === 'function') await initApp();
    } catch (e) {
        console.error('Login failed:', e);
        var detail = '';
        if (e && e.originalError) detail = e.originalError.message || String(e.originalError);
        else if (e && e.response && e.response.message) detail = e.response.message;
        else if (e && e.message) detail = e.message;
        else detail = String(e);
        errorEl.textContent = 'Login failed: ' + detail;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sign In';
    }
}
window.pbLogin = pbLogin;

function hideLoginScreen() {
    var overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'none';
}

function showLoginScreen() {
    var overlay = document.getElementById('loginOverlay');
    if (overlay) overlay.style.display = 'flex';
    var email = document.getElementById('loginEmail');
    if (email) { email.value = localStorage.getItem('pbEmail') || ''; email.focus(); }
    var urlRow = document.getElementById('loginUrlRow');
    var urlInput = document.getElementById('loginUrlInput');
    if (urlRow && urlInput) {
        urlInput.value = PB_URL_DEFAULT;
        urlRow.style.display = 'none';
        if (!url) setTimeout(function() { urlInput.focus(); }, 100);
    }
}

function pbLogout() {
    if (pb) pb.authStore.clear();
    localStorage.removeItem('pbAuthToken');
    showLoginScreen();
    updateConnStatus('off');
}
window.pbLogout = pbLogout;

// ==========================================
// POCKETBASE CRUD HELPERS
// ==========================================

async function pbLoadEntries(mode) {
    if (!pb || !pb.authStore.isValid) return [];
    try {
        var result = await pb.collection('entries').getFullList({
            filter: pb.filter('reportMode = {:mode}', { mode: mode }),
            sort: '-created',
        });
        return result.map(function(r) { r._pbId = r.id; return r; });
    } catch (e) {
        console.error('Failed to load entries:', e);
        updateConnStatus('err');
        return [];
    }
}

async function pbSaveEntry(entry) {
    if (!pb || !pb.authStore.isValid) return null;
    var data = Object.assign({}, entry);
    delete data._pbId;
    delete data.id;
    delete data.collectionId;
    delete data.collectionName;
    delete data.created;
    delete data.updated;
    try {
        if (entry._pbId) {
            var result = await pb.collection('entries').update(entry._pbId, data);
            result._pbId = result.id;
            return result;
        } else {
            var result = await pb.collection('entries').create(data);
            result._pbId = result.id;
            return result;
        }
    } catch (e) {
        console.error('Failed to save entry:', e);
        updateConnStatus('err');
        return null;
    }
}

async function pbDeleteEntry(pbId) {
    if (!pb || !pb.authStore.isValid || !pbId) return false;
    try {
        await pb.collection('entries').remove(pbId);
        return true;
    } catch (e) {
        console.error('Failed to delete entry:', e);
        updateConnStatus('err');
        return false;
    }
}

async function pbSaveNote(entryPbId, noteText) {
    if (!pb || !pb.authStore.isValid) return null;
    try {
        return await pb.collection('notes').create({
            entryId: entryPbId,
            text: noteText,
            date: new Date().toLocaleString(),
        });
    } catch (e) {
        console.error('Failed to save note:', e);
        return null;
    }
}

async function pbDeleteNote(noteId) {
    if (!pb || !pb.authStore.isValid || !noteId) return false;
    try {
        await pb.collection('notes').remove(noteId);
        return true;
    } catch (e) {
        console.error('Failed to delete note:', e);
        return false;
    }
}

async function pbLoadNotes(entryPbId) {
    if (!pb || !pb.authStore.isValid) return [];
    try {
        return await pb.collection('notes').getFullList({
            filter: pb.filter('entryId = {:id}', { id: entryPbId }),
            sort: '-created',
        });
    } catch (e) {
        console.error('Failed to load notes:', e);
        return [];
    }
}

async function pbLoadArchives(mode) {
    if (!pb || !pb.authStore.isValid) return [];
    try {
        return await pb.collection('archives').getFullList({
            filter: pb.filter('reportMode = {:mode}', { mode: mode }),
            sort: '-created',
        });
    } catch (e) {
        console.error('Failed to load archives:', e);
        return [];
    }
}

async function pbSaveArchive(month, mode, entriesJson) {
    if (!pb || !pb.authStore.isValid) return null;
    try {
        return await pb.collection('archives').create({
            month: month,
            reportMode: mode,
            entries: entriesJson,
        });
    } catch (e) {
        console.error('Failed to save archive:', e);
        return null;
    }
}

async function pbDeleteArchive(archiveId) {
    if (!pb || !pb.authStore.isValid || !archiveId) return false;
    try {
        await pb.collection('archives').remove(archiveId);
        return true;
    } catch (e) {
        console.error('Failed to delete archive:', e);
        return false;
    }
}

async function pbRestoreArchive(archiveId) {
    if (!pb || !pb.authStore.isValid) return [];
    try {
        var record = await pb.collection('archives').getOne(archiveId);
        return JSON.parse(record.entries || '[]');
    } catch (e) {
        console.error('Failed to restore archive:', e);
        return [];
    }
}

async function pbLoadSettings() {
    if (!pb || !pb.authStore.isValid) return null;
    try {
        var result = await pb.collection('settings').getFullList({
            filter: pb.filter('userId = {:id}', { id: pb.authStore.record.id }),
        });
        return result[0] || null;
    } catch (e) {
        console.error('Failed to load settings:', e);
        return null;
    }
}

async function pbSaveSettings(settings) {
    if (!pb || !pb.authStore.isValid) return null;
    try {
        var existing = await pbLoadSettings();
        var data = Object.assign({}, settings);
        data.userId = pb.authStore.record.id;
        if (existing) {
            return await pb.collection('settings').update(existing.id, data);
        } else {
            return await pb.collection('settings').create(data);
        }
    } catch (e) {
        console.error('Failed to save settings:', e);
        return null;
    }
}

// ==========================================
// POCKETBASE USER MANAGEMENT (admin only)
// ==========================================

function isAdmin() {
    return pb && pb.authStore.isValid && pb.authStore.record && pb.authStore.record.isAdmin === true;
}

async function pbListUsers() {
    if (!pb || !pb.authStore.isValid || !isAdmin()) return [];
    try {
        return await pb.collection('users').getFullList({ sort: 'created' });
    } catch (e) {
        console.error('Failed to list users:', e);
        return [];
    }
}

async function pbCreateUser(email, password, name) {
    if (!pb || !pb.authStore.isValid || !isAdmin()) return null;
    try {
        return await pb.collection('users').create({
            email: email,
            password: password,
            passwordConfirm: password,
            name: name,
            isAdmin: false,
        });
    } catch (e) {
        console.error('Failed to create user:', e);
        throw e;
    }
}

async function pbDeleteUser(userId) {
    if (!pb || !pb.authStore.isValid || !isAdmin() || !userId) return false;
    try {
        await pb.collection('users').delete(userId);
        return true;
    } catch (e) {
        console.error('Failed to delete user:', e);
        return false;
    }
}

async function pbUpdateUser(userId, data) {
    if (!pb || !pb.authStore.isValid || !isAdmin() || !userId) return null;
    try {
        return await pb.collection('users').update(userId, data);
    } catch (e) {
        console.error('Failed to update user:', e);
        throw e;
    }
}

function pbSubscribeEntries(callback) {
    if (!pb || !pb.authStore.isValid) return;
    try {
        pb.collection('entries').subscribe('*', function(e) {
            callback(e.action, e.record);
        });
    } catch (e) {
        console.error('Real-time subscribe failed:', e);
    }
}

async function pbSearchEntries(query) {
    if (!pb || !pb.authStore.isValid) return [];
    if (!query || query.length < 2) return [];
    try {
        var q = query.toLowerCase();
        var filterStr = pb.filter(
            'participantName ~ {:q} || phone ~ {:q} || email ~ {:q} || program ~ {:q} || status ~ {:q} || staffName ~ {:q} || address ~ {:q} || emergencyName ~ {:q} || emergencyPhone ~ {:q} || referralSource ~ {:q} || referralAgency ~ {:q}',
            { q: q }
        );
        var result = await pb.collection('entries').getFullList({
            filter: filterStr,
            sort: '-created',
        });
        return result.map(function(r) { r._pbId = r.id; return r; });
    } catch (e) {
        console.error('Global search failed:', e);
        return [];
    }
}

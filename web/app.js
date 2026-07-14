// ==========================================
// TAURI-SPECIFIC CODE (no bundler / no ES imports)
// Uses window.__TAURI__ globals injected by Tauri runtime.
// ==========================================

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

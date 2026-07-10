// ==========================================
// 1. IMPORTS (Must be at the very top)
// ==========================================
import { writeBinaryFile } from '@tauri-apps/plugin-fs';
import { message } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import * as XLSX from 'xlsx';

// ==========================================
// 2. GLOBAL STATE
// ==========================================
let relUploads = JSON.parse(localStorage.getItem('relUploads')) || [];
let relStatusRecords = JSON.parse(localStorage.getItem('relStatusRecords')) || [];

// ==========================================
// 3. CORE LOGIC: File Upload & Management
// ==========================================
function handleRelationalUpload(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    files.forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const data = JSON.parse(e.target.result);
            const uploadId = Date.now();

            // Track the file
            relUploads.push({
                id: uploadId,
                fileName: file.name,
                date: new Date().toLocaleDateString()
            });

            // Tag all records with the uploadId so they can be deleted together
            data.status_records.forEach(record => {
                record.uploadId = uploadId;
                relStatusRecords.push(record);
            });

            saveRelational();
            renderUploadList();

            // Note: Assuming renderQuarterlyReport exists elsewhere in your code
            if (typeof renderQuarterlyReport === 'function') {
                renderQuarterlyReport();
            }
        };
        reader.readAsText(file);
    });
}

function renderUploadList() {
    const listDiv = document.getElementById('uploadList');
    if (!listDiv) return;

    // Clear the current list
    listDiv.innerHTML = '';

    // --- LOGO SECTION ---
    const logoContainer = document.createElement('div');
    logoContainer.style = `
        display: flex; 
        flex-direction: column; 
        align-items: center; 
        justify-content: center; 
        padding: 20px; 
        border-bottom: 1px solid #e2e8f0;
    `;
    logoContainer.innerHTML = `
        <img src="./indepthlogo.png" alt="Logo" style="width: 80%; max-width: 150px; height: auto;">
        <h2 style="margin: 15px 0 0 0; font-size: 16px; text-align: center; line-height: 1.2;">
            Learning<br>Resources<br>Program
        </h2>
        <p style="font-size: 12px; color: #718096; margin-top: 5px; text-align: center;">
            Monthly Reports
        </p>
    `;
    listDiv.appendChild(logoContainer);
    // --------------------

    if (relUploads.length === 0) {
        const emptyMsg = document.createElement('p');
        emptyMsg.style = "padding:20px; color:#a0aec0; font-size:12px; text-align:center;";
        emptyMsg.innerText = "No monthly JSON reports uploaded yet.";
        listDiv.appendChild(emptyMsg);
        return;
    }

    relUploads.forEach((upload, index) => {
        const item = document.createElement('div');
        item.style = "display:flex; justify-content:space-between; padding:12px; border-bottom:1px solid #e2e8f0; align-items:center; background:#fff;";
        item.innerHTML = `
            <div style="display:flex; align-items:center; gap:10px;">
                <div style="font-size:20px;">📁</div>
                <div>
                    <div style="font-weight:600; font-size:14px;">${upload.fileName}</div>
                    <div style="font-size:11px; color:#718096;">Imported: ${upload.date}</div>
                </div>
            </div>
            <button class="btn-danger" onclick="deleteUpload(${index})" style="padding:6px 10px; cursor:pointer; background:#e53e3e; color:white; border:none; border-radius:4px;">Delete</button>
        `;
        listDiv.appendChild(item);
    });
}

// Attach to window so the inline HTML onclick="deleteUpload()" can find it
window.deleteUpload = function (index) {
    const upload = relUploads[index];
    if (!confirm(`Permanently delete ${upload.fileName} and all associated status records?`)) return;

    // Remove from array
    relUploads.splice(index, 1);

    // Cascading Delete
    relStatusRecords = relStatusRecords.filter(r => r.uploadId !== upload.id);

    saveRelational();
    renderUploadList();
    if (typeof renderQuarterlyReport === 'function') {
        renderQuarterlyReport();
    }
}

function saveRelational() {
    localStorage.setItem('relUploads', JSON.stringify(relUploads));
    localStorage.setItem('relStatusRecords', JSON.stringify(relStatusRecords));
}

// ==========================================
// 4. DIRECT SAVE LOGIC (Replaces old web download)
// ==========================================
async function submitReport() {
    try {
        const table = document.getElementById('report-table');
        if (!table) {
            await message('Could not find the report table to export.', { title: 'Error', kind: 'error' });
            return;
        }

        // Generate the Excel binary data from your HTML table
        const wb = XLSX.utils.table_to_book(table);
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });

        // Generate a unique filename with today's date
        const dateString = new Date().toISOString().split('T')[0];
        const fileName = `LRP_Report_${dateString}.xlsx`;

        // The exact path allowed in your tauri.conf.json scope
        const filePath = `Z:\\JHSSHARE\\LRP Monthly Reports\\${fileName}`;

        // Call the Tauri API to write the file silently
        await writeBinaryFile(filePath, new Uint8Array(wbout));

        // Trigger native Windows success message
        await message(`Report successfully saved to:\n${filePath}`, { title: 'Success', kind: 'info' });

    } catch (error) {
        console.error('Failed to save the report:', error);
        await message('Could not save the report. Please check your connection to the Z: drive.', { title: 'Save Failed', kind: 'error' });
    }
}

// ==========================================
// 6. TAURI UPDATER
// ==========================================
async function checkForTauriUpdate() {
    try {
        const update = await check();
        if (update) {
            const confirmed = await message(
                `Version ${update.version} is available.\n\nDo you want to download and install the update? The app will restart automatically.`,
                { title: 'Update Available', kind: 'info' }
            );
            if (confirmed) {
                let downloaded = 0;
                await update.downloadAndInstall((event) => {
                    if (event.event === 'Started' && event.data.contentLength) {
                        console.log(`Downloading ${event.data.contentLength} bytes...`);
                    } else if (event.event === 'Progress') {
                        downloaded += event.data.chunkLength;
                    }
                });
                const { relaunch } = window.__TAURI__.process;
                await relaunch();
            }
        } else {
            await message('You are running the latest version.', { title: 'No Updates', kind: 'info' });
        }
    } catch (e) {
        console.error('Update check failed:', e);
        await message('Could not check for updates. Please check your internet connection.', { title: 'Update Check Failed', kind: 'error' });
    }
}
window.checkForTauriUpdate = checkForTauriUpdate;

// ==========================================
// 7. INITIALIZATION
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Render the list on load
    renderUploadList();

    // Attach the new silent save function to your Submit button
    // Ensure your button in the HTML has the id="submitBtn"
    const submitBtn = document.getElementById('submitBtn');
    if (submitBtn) {
        submitBtn.addEventListener('click', () => {
            submitReport();
        });
    }

    // Auto-check for Tauri updates on startup
    checkForTauriUpdate();
});
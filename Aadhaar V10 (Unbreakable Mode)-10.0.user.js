// ==UserScript==
// @name         Aadhaar V10 (Unbreakable Mode)
// @namespace    http://tampermonkey.net/
// @version      10.0
// @description  Uses Event Delegation to prevent 'disconnects' + Permanent DB
// @author       Gemini
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // --- CONFIGURATION ---
    const DB_NAME = 'Aadhaar_Perm_v9'; // Keep v9 DB so you don't have to reload CSV
    const STORE_NAME = 'members_v9';
    const BATCH_SIZE = 5000;
    // ---------------------

    // 1. UI PANEL (Keeps your interface)
    const panel = document.createElement('div');
    Object.assign(panel.style, {
        position: 'fixed', bottom: '10px', right: '10px', zIndex: '10000',
        padding: '15px', background: 'white', border: '1px solid #ccc',
        borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        fontFamily: 'Arial, sans-serif', fontSize: '13px', width: '260px'
    });

    panel.innerHTML = `
        <strong style="display:block; margin-bottom:10px; color:#333;">⚙️ Aadhaar Auto-Fill (V10)</strong>
        <div id="dbStatus" style="margin-bottom:10px; padding:8px; background:#f8f9fa; border-radius:4px; font-weight:bold; color:#666; text-align:center;">Checking DB...</div>
        <div id="settingsArea">
            <input type="text" id="def_sub" placeholder="Sub-District" style="width:100%; margin-bottom:5px; padding:4px;">
            <input type="text" id="def_block" placeholder="Block" style="width:100%; margin-bottom:10px; padding:4px;">
        </div>
        <button id="loadBtn" style="width:100%; padding:8px; background:#007bff; color:white; border:none; border-radius:4px; cursor:pointer;">📂 Upload New CSV</button>
        <div id="progressMsg" style="margin-top:8px; font-size:11px; color:#333; max-height:100px; overflow-y:auto;"></div>
    `;
    document.body.appendChild(panel);

    // Save/Load Settings
    const subIn = document.getElementById('def_sub');
    const blkIn = document.getElementById('def_block');
    subIn.value = localStorage.getItem('abdm_sub') || '';
    blkIn.value = localStorage.getItem('abdm_block') || '';
    subIn.oninput = (e) => localStorage.setItem('abdm_sub', e.target.value);
    blkIn.oninput = (e) => localStorage.setItem('abdm_block', e.target.value);

    // 2. DATABASE HELPERS
    function openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, 1);
            request.onerror = () => reject('DB Error');
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
                    store.createIndex("last4", "last4", { unique: false });
                }
            };
            request.onsuccess = (e) => resolve(e.target.result);
        });
    }

    async function checkExistingData() {
        try {
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const countReq = store.count();
            countReq.onsuccess = () => {
                const count = countReq.result;
                const statusBox = document.getElementById('dbStatus');
                const btn = document.getElementById('loadBtn');
                if (count > 0) {
                    statusBox.innerHTML = `✅ Ready: ${count.toLocaleString()} Records`;
                    statusBox.style.background = '#d4edda'; statusBox.style.color = '#155724';
                    btn.innerText = "🔄 Update CSV (Optional)"; btn.style.background = "#6c757d";
                } else {
                    statusBox.innerHTML = `❌ No Data Found`;
                    statusBox.style.background = '#f8d7da'; statusBox.style.color = '#721c24';
                }
            };
        } catch (e) { console.error(e); }
    }
    checkExistingData();

    // 3. CSV LOADER (Same as before)
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);
    document.getElementById('loadBtn').onclick = () => fileInput.click();

    fileInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const msg = document.getElementById('progressMsg');
        msg.innerText = 'Processing...';
        const reader = new FileReader();
        reader.onload = async (event) => {
            const rows = event.target.result.split(/\r\n|\n/);
            const totalRows = rows.length;
            const db = await openDB();
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            store.clear();
            let processed = 0;

            function processBatch(startIndex) {
                const endIndex = Math.min(startIndex + BATCH_SIZE, totalRows);
                const txBatch = db.transaction(STORE_NAME, 'readwrite');
                const storeBatch = txBatch.objectStore(STORE_NAME);
                for (let i = startIndex; i < endIndex; i++) {
                    const cols = rows[i].split(',');
                    if (cols.length >= 3) {
                        const rawUid = cols[1].trim();
                        const cleanDigits = rawUid.replace(/[^0-9]/g, '');
                        if (cleanDigits.length >= 1) {
                            let finalLast4 = cleanDigits.slice(-4).padStart(4, '0');
                            storeBatch.put({
                                name: cols[0].trim(),
                                uid_display: rawUid,
                                last4: finalLast4,
                                gender: cols[2].trim()
                            });
                            processed++;
                        }
                    }
                }
                txBatch.oncomplete = () => {
                    const pct = Math.round((endIndex / totalRows) * 100);
                    msg.innerHTML = `⏳ Loading: <b>${pct}%</b>`;
                    if (endIndex < totalRows) setTimeout(() => processBatch(endIndex), 0);
                    else { msg.innerHTML = ``; checkExistingData(); alert("Done!"); }
                };
            }
            processBatch(0);
        };
        reader.readAsText(file);
    };

    // 4. THE NEW "UNBREAKABLE" ENGINE (Event Delegation)

    // Create the Datalist once and keep it in the DOM
    const listID = "aadhaar-master-list";
    let dataList = document.getElementById(listID);
    if (!dataList) {
        dataList = document.createElement('datalist');
        dataList.id = listID;
        document.body.appendChild(dataList);
    }

    let currentMatches = [];

    // Helper: Identify if an element is the Aadhaar Input
    function isAadhaarInput(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        const placeholder = el.placeholder ? el.placeholder.toLowerCase() : '';
        const parentText = el.parentElement ? el.parentElement.innerText.toLowerCase() : '';
        return placeholder.includes('aadhaar') || parentText.includes('aadhaar');
    }

    // Helper: Identify if an element is the Name Input
    function isNameInput(el) {
        if (!el || el.tagName !== 'INPUT') return false;
        const placeholder = el.placeholder ? el.placeholder.toLowerCase() : '';
        const parentText = el.parentElement ? el.parentElement.innerText.toLowerCase() : '';
        return placeholder.includes('name') || parentText.includes('name');
    }

    // Listen to ALL input events on the page (The "Unbreakable" Listener)
    document.addEventListener('input', async function(e) {
        const target = e.target;

        // A. If typing in Aadhaar Field
        if (isAadhaarInput(target)) {
            const val = target.value.replace(/\s/g, '');

            // Find the Name field nearby
            const inputs = Array.from(document.querySelectorAll('input'));
            const nameField = inputs.find(i => isNameInput(i));

            if (nameField && val.length === 12) {
                // Link the datalist to the name field dynamically
                nameField.setAttribute('list', listID);

                const last4 = val.slice(-4);
                const db = await openDB();
                const tx = db.transaction(STORE_NAME, 'readonly');
                const store = tx.objectStore(STORE_NAME);
                const req = store.index("last4").getAll(last4);

                req.onsuccess = () => {
                    currentMatches = req.result;
                    dataList.innerHTML = '';

                    if (currentMatches.length > 0) {
                        currentMatches.forEach(m => {
                            const opt = document.createElement('option');
                            opt.value = m.name;
                            opt.label = `...${m.last4}`;
                            dataList.appendChild(opt);
                        });

                        if (currentMatches.length === 1) {
                            fillAll(currentMatches[0]);
                        } else {
                            // Focus name so user sees dropdown
                            nameField.focus();
                        }
                    }
                };
            }
        }

        // B. If selecting Name from list
        if (isNameInput(target)) {
            // Check if value matches a person in our memory
            const person = currentMatches.find(p => p.name === target.value);
            if (person) {
                fillAll(person);
            }
        }
    });

    // 5. FILL LOGIC
    function fillAll(person) {
        // Find fields again (fresh search ensures we get current elements)
        const inputs = Array.from(document.querySelectorAll('input'));
        const selects = Array.from(document.querySelectorAll('select'));
        const labels = Array.from(document.querySelectorAll('label'));

        const nameField = inputs.find(i => isNameInput(i));
        const genderField = selects.find(s => s.innerHTML.toLowerCase().includes('male'));

        const findByText = (els, txt) => els.find(el => (el.name||'').toLowerCase().includes(txt) || (el.parentElement?.innerText||'').toLowerCase().includes(txt));
        const subDist = findByText(selects, 'sub-district') || findByText(selects, 'sub district');
        const block = findByText(selects, 'block');

        const consentLabel = labels.find(l => l.innerText.toLowerCase().includes('consent'));
        let consentCheck = null;
        if (consentLabel) {
            if (consentLabel.htmlFor) consentCheck = document.getElementById(consentLabel.htmlFor);
            if (!consentCheck) consentCheck = consentLabel.querySelector('input[type="checkbox"]');
            if (!consentCheck) consentCheck = consentLabel.parentElement.querySelector('input[type="checkbox"]');
        }

        // Execute Fill
        if (nameField && nameField.value !== person.name) {
            nameField.value = person.name;
            nameField.dispatchEvent(new Event('input', { bubbles: true }));
        }

        setDropdown(genderField, person.gender);

        const dSub = document.getElementById('def_sub').value;
        const dBlock = document.getElementById('def_block').value;

        setTimeout(() => {
            if (dSub) setDropdown(subDist, dSub);
            if (dBlock) setDropdown(block, dBlock);
            if (consentCheck && !consentCheck.checked) {
                consentCheck.click();
            }
        }, 100);
    }

    function setDropdown(select, val) {
        if (!select || !val) return;
        const target = val.toLowerCase().trim();
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].text.toLowerCase().includes(target) || select.options[i].value.toLowerCase().includes(target)) {
                select.selectedIndex = i;
                select.dispatchEvent(new Event('change', { bubbles: true }));
                break;
            }
        }
    }

})();
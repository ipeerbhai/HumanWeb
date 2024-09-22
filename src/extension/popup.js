document.getElementById('saveKey').addEventListener('click', () => {
    const apiKey = document.getElementById('apiKey').value;

    if (apiKey) {
        // Save API key to extension storage
        browser.storage.local.set({ apiKey }).then(() => {
            alert('API key saved successfully!');
        });
    }
});

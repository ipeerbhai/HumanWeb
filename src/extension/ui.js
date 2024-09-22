// ui.js

let script = "";
let isExecuting = false;
let currentLine = 0;
let waitingForUser = false;

let BASE_URL = 'http://localhost:8670';

function createUI() {
    if (!document.getElementById('extension-chat-icon')) {
        createChatIcon();
        createChatWindow();
    }
}

function createChatIcon() {
    const chatIcon = document.createElement('div');
    chatIcon.id = 'extension-chat-icon';
    chatIcon.innerHTML = '💬';
    chatIcon.addEventListener('click', toggleChatWindow);
    document.body.appendChild(chatIcon);
}

function createChatWindow() {
    const chatWindow = document.createElement('div');
    chatWindow.id = 'extension-chat-window';
    chatWindow.style.display = 'none';
    chatWindow.innerHTML = `
        <div id="chat-header">Web Automation DSL</div>
        <div id="chat-content">
            <textarea id="script-area" rows="10" cols="50"></textarea>
            <button id="execute-button">Execute Script</button>
            <button id="clear-button">Clear Script</button>
            <div id="output-area"></div>
            <div id="command-addition">
                <h3>Add New Command</h3>
                <select id="command-select"></select>
                <div id="command-inputs"></div>
                <button id="add-command-button">Add Command</button>
            </div>
        </div>
    `;
    document.body.appendChild(chatWindow);

    document.getElementById('execute-button').addEventListener('click', executeScript);
    document.getElementById('clear-button').addEventListener('click', clearScript);
    document.getElementById('command-select').addEventListener('change', updateCommandInputs);
    document.getElementById('add-command-button').addEventListener('click', addCommand);

    loadScript();
    loadCommandStructure();
}

function toggleChatWindow() {
    const chatWindow = document.getElementById('extension-chat-window');
    chatWindow.style.display = chatWindow.style.display === 'none' ? 'block' : 'none';
}

async function fetchAPI(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        window.postMessage({ type: 'FROM_PAGE', content: { endpoint, options } }, '*');
        
        function handleMessage(event) {
            if (event.source != window) return;
            if (event.data.type && event.data.type === 'FROM_EXTENSION') {
                window.removeEventListener('message', handleMessage);
                if (event.data.content.success) {
                    resolve(event.data.content.data);
                } else {
                    reject(new Error(event.data.content.error));
                }
            }
        }
        
        window.addEventListener('message', handleMessage);
    });
}

async function loadScript() {
    try {
        const data = await fetchAPI('/get_script');
        script = data.script;
        document.getElementById('script-area').value = script;
    } catch (error) {
        console.error('Failed to load script:', error);
    }
}

async function loadCommandStructure() {
    try {
        const commandStructure = await fetchAPI('/get_command_structure');
        const selectElement = document.getElementById('command-select');
        selectElement.innerHTML = ''; // Clear existing options
        for (const command in commandStructure) {
            const option = document.createElement('option');
            option.value = command;
            option.textContent = command;
            selectElement.appendChild(option);
        }
        updateCommandInputs();
    } catch (error) {
        console.error('Failed to load command structure:', error);
    }
}

async function executeScript() {
    isExecuting = true;
    currentLine = 0;
    waitingForUser = false;
    document.getElementById('output-area').innerHTML = '';
    await updateExecutionStatus();
    runNextCommand();
}

async function runNextCommand() {
    if (!isExecuting) return;

    const lines = script.trim().split('\n');
    if (currentLine >= lines.length) {
        isExecuting = false;
        await updateExecutionStatus();
        return;
    }

    const line = lines[currentLine].trim();
    if (!line) {
        currentLine++;
        runNextCommand();
        return;
    }

    const [command, ...args] = line.split(' ');
    try {
        const result = await fetchAPI('/execute_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command, args: args.join(' ') })
        });

        document.getElementById('output-area').innerHTML += `<p>${result.result}</p>`;

        if (command === 'ASK_USER') {
            waitingForUser = true;
            await updateExecutionStatus();
            const confirmButton = document.createElement('button');
            confirmButton.textContent = 'Confirm';
            confirmButton.onclick = async () => {
                waitingForUser = false;
                currentLine++;
                await updateExecutionStatus();
                runNextCommand();
            };
            document.getElementById('output-area').appendChild(confirmButton);
        } else {
            currentLine++;
            setTimeout(runNextCommand, 1000);
        }
    } catch (error) {
        console.error('Failed to execute command:', error);
        isExecuting = false;
        await updateExecutionStatus();
    }
}

async function clearScript() {
    script = "";
    document.getElementById('script-area').value = "";
    document.getElementById('output-area').innerHTML = "";
    isExecuting = false;
    currentLine = 0;
    waitingForUser = false;
    await updateExecutionStatus();
    await updateScript();
}

async function updateCommandInputs() {
    const command = document.getElementById('command-select').value;
    const inputsContainer = document.getElementById('command-inputs');
    inputsContainer.innerHTML = '';

    try {
        const commandStructure = await fetchAPI('/get_command_structure');
        commandStructure[command].forEach(arg => {
            const input = document.createElement('input');
            input.type = 'text';
            input.placeholder = arg;
            inputsContainer.appendChild(input);
        });
    } catch (error) {
        console.error('Failed to update command inputs:', error);
    }
}

async function addCommand() {
    const command = document.getElementById('command-select').value;
    const inputs = document.getElementById('command-inputs').getElementsByTagName('input');
    const args = Array.from(inputs).map(input => input.value);

    let commandString = `${command} ${args.map(arg => JSON.stringify(arg)).join(' ')}`;

    try {
        await fetchAPI('/add_command', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ command: commandString, args: '' })
        });
        loadScript();
    } catch (error) {
        console.error('Failed to add command:', error);
    }
}

async function updateScript() {
    try {
        await fetchAPI('/update_script', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ script: document.getElementById('script-area').value })
        });
    } catch (error) {
        console.error('Failed to update script:', error);
    }
}

async function updateExecutionStatus() {
    try {
        await fetchAPI('/set_execution_status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_line: currentLine, waiting_for_user: waitingForUser, is_executing: isExecuting })
        });
    } catch (error) {
        console.error('Failed to update execution status:', error);
    }
}

function initUI() {
    if (!document.getElementById('extension-chat-icon')) {
        createUI();
    }
}

// Listen for the INIT_UI message
window.addEventListener('message', function(event) {
    if (event.source != window) return;
    if (event.data.type && event.data.type === 'INIT_UI') {
        initUI();
    }
});

window.createWebAutomationDSLUI = initUI;
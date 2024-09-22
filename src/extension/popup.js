// popup.js

let script = "";
let isExecuting = false;
let waitingForUser = false;

let BASE_URL = 'http://localhost:8670';

// Function to load the saved script
async function loadScript() {
    try {
        const response = await fetchAPI('/get_script');
        script = response.script;
        document.getElementById('script-area').value = script;
    } catch (error) {
        console.error('Error loading script:', error);
    }
}

// Function to save the script
async function saveScript() {
    try {
        const scriptContent = document.getElementById('script-area').value;
        await fetchAPI('/update_script', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ script: scriptContent }),
        });
    } catch (error) {
        console.error('Error saving script:', error);
    }
}

// Function to execute the script
async function executeScript() {
    if (isExecuting) {
        console.log('Script is already executing');
        return;
    }

    isExecuting = true;
    waitingForUser = false;
    document.getElementById('output-area').innerHTML = '';

    try {
        await runScript();
    } catch (error) {
        console.error('Error executing script:', error);
        document.getElementById('output-area').innerHTML += `Error: ${error.message}<br>`;
    } finally {
        isExecuting = false;
    }
}

async function runScript() {
    const response = await fetchAPI('/execute_script', {
        method: 'POST'
    });

    handleExecutionResponse(response);
}

function handleExecutionResponse(response) {
    const outputArea = document.getElementById('output-area');
    
    response.results.forEach(result => {
        outputArea.innerHTML += `${result.line}: ${result.result}<br>`;
    });

    if (response.waiting_for_user) {
        waitingForUser = true;
        showUserPrompt(response.user_prompt);
    } else if (!response.script_completed) {
        runScript();
    } else {
        outputArea.innerHTML += 'Script execution completed.<br>';
        isExecuting = false;
    }
}

function showUserPrompt(prompt) {
    const outputArea = document.getElementById('output-area');
    outputArea.innerHTML += `<div id="user-prompt">
        <p>User Action Required: ${prompt}</p>
        <button id="user-action-complete">I've completed the action</button>
    </div>`;

    document.getElementById('user-action-complete').addEventListener('click', continueExecution);
}

async function continueExecution() {
    if (!waitingForUser) return;

    waitingForUser = false;
    document.getElementById('user-prompt').remove();

    try {
        const response = await fetchAPI('/continue_execution', {
            method: 'POST'
        });

        handleExecutionResponse(response);
    } catch (error) {
        console.error('Error continuing execution:', error);
        document.getElementById('output-area').innerHTML += `Error: ${error.message}<br>`;
    }
}

// Function to clear the script
function clearScript() {
    script = "";
    document.getElementById('script-area').value = "";
    document.getElementById('output-area').innerHTML = "";
    fetchAPI('/clear_script', { method: 'POST' });
}

// Function to load command structure
async function loadCommandStructure() {
    try {
        const response = await fetchAPI('/get_command_structure');
        const commandSelect = document.getElementById('command-select');
        
        for (const command in response) {
            const option = document.createElement('option');
            option.value = command;
            option.textContent = command;
            commandSelect.appendChild(option);
        }

        updateCommandInputs();
    } catch (error) {
        console.error('Error loading command structure:', error);
    }
}

// Function to update command inputs
function updateCommandInputs() {
    const commandSelect = document.getElementById('command-select');
    const selectedCommand = commandSelect.value;
    const commandInputs = document.getElementById('command-inputs');
    commandInputs.innerHTML = '';

    fetchAPI('/get_command_structure')
        .then(response => {
            const parameters = response[selectedCommand];
            parameters.forEach(param => {
                const input = document.createElement('input');
                input.type = 'text';
                input.placeholder = param;
                commandInputs.appendChild(input);
            });
        })
        .catch(error => console.error('Error updating command inputs:', error));
}

// Function to add a command
function addCommand() {
    const commandSelect = document.getElementById('command-select');
    const selectedCommand = commandSelect.value;
    const inputs = document.getElementById('command-inputs').getElementsByTagName('input');
    const parameters = Array.from(inputs).map(input => `"${input.value}"`);

    const command = `${selectedCommand} ${parameters.join(' ')}`;
    const scriptArea = document.getElementById('script-area');
    scriptArea.value += (scriptArea.value ? '\n' : '') + command;

    saveScript();
}

// Modified fetch function to use chrome.runtime.sendMessage
async function fetchAPI(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({action: 'fetchAPI', endpoint, options}, response => {
            if (response.success) {
                resolve(response.data);
            } else {
                reject(new Error(response.error));
            }
        });
    });
}

// Event listeners
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('execute-button').addEventListener('click', executeScript);
    document.getElementById('clear-button').addEventListener('click', clearScript);
    document.getElementById('command-select').addEventListener('change', updateCommandInputs);
    document.getElementById('add-command-button').addEventListener('click', addCommand);

    loadScript();
    loadCommandStructure();
});
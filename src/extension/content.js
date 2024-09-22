// content.js

let lastClickX = 0;
let lastClickY = 0;

// Listen for right-clicks to store the coordinates
document.addEventListener('mousedown', function(event) {
    if (event.button === 2) {  // Right click
        lastClickX = event.clientX;
        lastClickY = event.clientY;
    }
});

// Function to show modal and get element name
function showModal(element) {
    return new Promise((resolve, reject) => {
        const modal = document.createElement('div');
        modal.style.position = 'fixed';
        modal.style.left = '50%';
        modal.style.top = '50%';
        modal.style.transform = 'translate(-50%, -50%)';
        modal.style.backgroundColor = 'white';
        modal.style.padding = '20px';
        modal.style.border = '1px solid black';
        modal.style.zIndex = '10000';

        const input = document.createElement('input');
        input.type = 'text';
        input.placeholder = 'Enter element name';

        const confirmButton = document.createElement('button');
        confirmButton.textContent = 'Confirm';
        confirmButton.style.marginLeft = '10px';

        const cancelButton = document.createElement('button');
        cancelButton.textContent = 'Cancel';
        cancelButton.style.marginLeft = '10px';

        modal.appendChild(input);
        modal.appendChild(confirmButton);
        modal.appendChild(cancelButton);

        document.body.appendChild(modal);

        confirmButton.addEventListener('click', () => {
            const elementName = input.value.trim();
            if (elementName) {
                document.body.removeChild(modal);
                resolve(elementName);
            }
        });

        cancelButton.addEventListener('click', () => {
            document.body.removeChild(modal);
            reject('Cancelled');
        });

        input.focus();
    });
}

// Function to send selected element to background script
function sendSelectedElement(elementHTML, elementName) {
    chrome.runtime.sendMessage({
        action: 'elementSelected',
        html: elementHTML,
        name: elementName
    });
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "grabElement") {
        const clickedElement = document.elementFromPoint(lastClickX, lastClickY);
        
        if (clickedElement) {
            showModal(clickedElement)
                .then(elementName => {
                    sendSelectedElement(clickedElement.outerHTML, elementName);
                    console.log(`Selected element "${elementName}":`, clickedElement.outerHTML);
                })
                .catch(error => console.log('Element selection cancelled:', error));
        }
    }
});

// Function to highlight an element
function highlightElement(element) {
    const originalOutline = element.style.outline;
    const originalBackgroundColor = element.style.backgroundColor;

    element.style.outline = '2px solid red';
    element.style.backgroundColor = 'yellow';

    setTimeout(() => {
        element.style.outline = originalOutline;
        element.style.backgroundColor = originalBackgroundColor;
    }, 2000);  // Remove highlight after 2 seconds
}

// Function to find element by various selectors
function findElement(selector) {
    // Try to find by ID
    let element = document.getElementById(selector);
    if (element) return element;

    // Try to find by name
    element = document.getElementsByName(selector)[0];
    if (element) return element;

    // Try to find by class name
    element = document.getElementsByClassName(selector)[0];
    if (element) return element;

    // Try to find by tag name
    element = document.getElementsByTagName(selector)[0];
    if (element) return element;

    // Try to find by CSS selector
    element = document.querySelector(selector);
    if (element) return element;

    // If nothing found, return null
    return null;
}

// Listen for commands from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'executeCommand') {
        const { command, params } = request;
        
        switch (command) {
            case 'click':
                const clickElement = findElement(params.selector);
                if (clickElement) {
                    highlightElement(clickElement);
                    clickElement.click();
                    sendResponse({success: true, message: `Clicked element: ${params.selector}`});
                } else {
                    sendResponse({success: false, message: `Element not found: ${params.selector}`});
                }
                break;

            case 'type':
                const typeElement = findElement(params.selector);
                if (typeElement) {
                    highlightElement(typeElement);
                    typeElement.value = params.text;
                    sendResponse({success: true, message: `Typed "${params.text}" into element: ${params.selector}`});
                } else {
                    sendResponse({success: false, message: `Element not found: ${params.selector}`});
                }
                break;

            case 'wait':
                setTimeout(() => {
                    sendResponse({success: true, message: `Waited for ${params.seconds} seconds`});
                }, params.seconds * 1000);
                break;

            default:
                sendResponse({success: false, message: `Unknown command: ${command}`});
        }
        return true;  // Indicates that the response will be sent asynchronously
    }
});
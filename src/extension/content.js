// content.js

// Create and append the modal to the body
const modal = document.createElement('div');
modal.id = 'element-name-modal';
modal.innerHTML = `
    <div class="modal-content">
        <input type="text" id="element-name-input" placeholder="Enter element name (Press Enter to submit, Escape to cancel)">
    </div>
`;
document.body.appendChild(modal);

// Function to highlight the selected element
function highlightElement(element) {
    const oldOutline = element.style.outline;
    const oldOutlineOffset = element.style.outlineOffset;
    element.style.outline = '2px solid #ff0000'; // Red outline
    element.style.outlineOffset = '1px';
    return () => {
        element.style.outline = oldOutline;
        element.style.outlineOffset = oldOutlineOffset;
    };
}

// Function to show the modal and get user input
function showModal(element) {
    return new Promise((resolve, reject) => {
        const modalElement = document.getElementById('element-name-modal');
        const inputElement = document.getElementById('element-name-input');

        const removeHighlight = highlightElement(element);

        modalElement.style.display = 'block';
        inputElement.focus();

        inputElement.onkeyup = (event) => {
            if (event.key === 'Enter') {
                const name = inputElement.value.trim();
                if (name) {
                    modalElement.style.display = 'none';
                    inputElement.value = ''; // Clear the input
                    removeHighlight();
                    resolve(name);
                }
            }
            if (event.key === 'Escape') {
                modalElement.style.display = 'none';
                inputElement.value = ''; // Clear the input
                removeHighlight();
                reject('Cancelled');
            }
        };
    });
}

// Function to send selected element to browser service
function sendSelectedElement(elementHtml, elementName) {
    const serviceUrl = 'http://localhost:8676/v1/connectors/browser/update_selected_element/';
    
    fetch(serviceUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            element_html: elementHtml,
            element_name: elementName
        }),
    })
    .then(response => response.json())
    .then(data => console.log('Success:', data))
    .catch((error) => console.error('Error:', error));
}

// Variables to store the last click position
let lastClickX = 0;
let lastClickY = 0;

// Add event listener to track the last click position
document.addEventListener('mousedown', (event) => {
    lastClickX = event.clientX;
    lastClickY = event.clientY;
});

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message) => {
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
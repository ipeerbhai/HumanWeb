// Variables to store the last click position
let lastClickX = 0;
let lastClickY = 0;

// Add event listener to track the last click position
document.addEventListener('mousedown', (event) => {
  lastClickX = event.clientX;
  lastClickY = event.clientY;
});

// Function to send selected element to browser service
function sendSelectedElement(elementHtml) {
  // You'll need to replace this with the actual URL of your browser service
  const serviceUrl = 'http://localhost:8676/v1/connectors/browser/update_selected_element/';
  
  fetch(serviceUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      element_html: elementHtml
    }),
  })
  .then(response => response.json())
  .then(data => console.log('Success:', data))
  .catch((error) => console.error('Error:', error));
}

// Listen for messages from the background script
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "grabElement") {
    // Get the clicked element
    const clickedElement = document.elementFromPoint(lastClickX, lastClickY);
    
    if (clickedElement) {
      // Send the element's outerHTML to the browser service
      sendSelectedElement(clickedElement.outerHTML);
      
      // Optionally, still log to console for debugging
      console.log(clickedElement.outerHTML);
    }
  }
});
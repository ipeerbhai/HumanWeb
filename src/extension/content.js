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
    // Get the clicked element
    const clickedElement = document.elementFromPoint(lastClickX, lastClickY);
    
    if (clickedElement) {
      // Print the element's outerHTML to the console
      console.log(clickedElement.outerHTML);
    }
  }
});
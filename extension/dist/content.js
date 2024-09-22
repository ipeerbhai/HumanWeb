"use strict";
// Create the overlay div
const overlay = document.createElement('div');
overlay.id = 'helloOverlay';
// Create the inner content div
const overlayContent = document.createElement('div');
overlayContent.id = 'helloContent';
overlayContent.innerText = 'Hello';
// Append content to the overlay
overlay.appendChild(overlayContent);
// Append the overlay to the body
document.body.appendChild(overlay);
// Variables to store the position of the mouse
let isDragging = false;
let offsetX = 0;
let offsetY = 0;
// Add event listeners to handle dragging
overlay.addEventListener('mousedown', (event) => {
    isDragging = true;
    // Calculate the mouse position relative to the overlay's top-left corner
    offsetX = event.clientX - overlay.offsetLeft;
    offsetY = event.clientY - overlay.offsetTop;
    overlay.style.cursor = 'move';
});
document.addEventListener('mousemove', (event) => {
    if (isDragging) {
        // Move the overlay based on the new mouse position
        overlay.style.left = `${event.clientX - offsetX}px`;
        overlay.style.top = `${event.clientY - offsetY}px`;
    }
});
document.addEventListener('mouseup', () => {
    isDragging = false;
    overlay.style.cursor = 'default';
});

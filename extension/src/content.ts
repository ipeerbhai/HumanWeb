// Create the overlay div
const overlay: HTMLDivElement = document.createElement('div');
overlay.id = 'helloOverlay';

// Create the inner content div
const overlayContent: HTMLDivElement = document.createElement('div');
overlayContent.id = 'helloContent';
overlayContent.innerText = 'Hello';

// Append content to the overlay
overlay.appendChild(overlayContent);

// Append the overlay to the body
document.body.appendChild(overlay);

// Variables to store the position of the mouse
let isDragging: boolean = false;
let offsetX: number = 0;
let offsetY: number = 0;

// Add event listeners to handle dragging
overlay.addEventListener('mousedown', (event: MouseEvent) => {
    isDragging = true;
    // Calculate the mouse position relative to the overlay's top-left corner
    offsetX = event.clientX - overlay.offsetLeft;
    offsetY = event.clientY - overlay.offsetTop;
    overlay.style.cursor = 'move';
});

document.addEventListener('mousemove', (event: MouseEvent) => {
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

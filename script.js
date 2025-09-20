function toggleMenu() {
    console.log("Toggle menu clicked");
    let nav = document.querySelector('#mobileNav ul');
    if (nav.style.display === "flex") {
        nav.style.display = "none";
    } else {
        nav.style.display = "flex";
    }
}

function closeMenu() {
    console.log("Close menu clicked");
    const viewportWidth = window.innerWidth;
    if (viewportWidth < 768) {
        document.querySelector('#mobileNav ul').style.display = "none";
    }
}

const canvas = document.getElementById("matrix");
const ctx = canvas.getContext("2d");

// Set canvas full-screen
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Set the font size and calculate the number of columns
let fontSize = 16;
let columns = Math.floor(canvas.width / fontSize);

// Each element in drops is the current y coordinate (in rows) for that column
let drops = Array.from({length: columns}, () => Math.floor(Math.random() * canvas.height / fontSize));

function draw() {
    // Draw a translucent black rectangle to create the fading trail effect.
    ctx.fillStyle = "rgba(0, 0, 0, 0.125)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.font = fontSize + "px monospace";

    // Loop over columns
    for (let i = 0; i < columns; i++) {
        const x = i * fontSize;
        const y = drops[i] * fontSize;
        // Random binary digit
        const char = Math.random() > 0.5 ? "1" : "0";

        // Darker style: dark green text on black
        ctx.fillStyle = "#004000"; // Green color
        ctx.fillText(char, x, y);

        // Reset drop to top if it has gone off the bottom randomly
        if (y > canvas.height && Math.random() > 0.975) {
            drops[i] = 0;
        }
        drops[i] += 1; // Slower drop speed
    }

    setTimeout(draw, 50); // higher number means slower frame rate
}
draw();

// Adjust the canvas size and reinitialize drops on window resize
window.addEventListener("resize", () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / fontSize);
    drops = Array.from({length: columns}, () => Math.floor(Math.random() * canvas.height / fontSize));
});

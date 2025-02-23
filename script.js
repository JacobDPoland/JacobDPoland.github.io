console.log("script.js loaded");

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

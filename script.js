document.addEventListener("DOMContentLoaded", function() {
    // Dark mode toggle
    const darkModeToggle = document.createElement("button");
    darkModeToggle.innerText = "Toggle Dark Mode";
    darkModeToggle.id = "dark-mode-toggle";
    document.body.insertBefore(darkModeToggle, document.body.firstChild);
    
    darkModeToggle.addEventListener("click", function() {
        document.body.classList.toggle("light-mode");
    });
    
    // Contact form validation
    const contactForm = document.querySelector("form");
    if (contactForm) {
        contactForm.addEventListener("submit", function(event) {
            const name = document.querySelector("input[name='name']").value.trim();
            const email = document.querySelector("input[name='email']").value.trim();
            const message = document.querySelector("textarea[name='message']").value.trim();
            
            if (!name || !email || !message) {
                alert("Please fill in all fields.");
                event.preventDefault();
            } else if (!validateEmail(email)) {
                alert("Please enter a valid email address.");
                event.preventDefault();
            }
        });
    }
    
    function validateEmail(email) {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    }
});

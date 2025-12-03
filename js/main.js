// Initialize Lucide Icons
lucide.createIcons();

// Navbar Scroll Effect
const navbar = document.getElementById('navbar');
window.addEventListener('scroll', () => {
    if (window.scrollY > 50) {
        navbar.classList.add('bg-white/80', 'backdrop-blur-md', 'border-b', 'border-gray-200');
        navbar.classList.remove('bg-transparent');
    } else {
        navbar.classList.remove('bg-white/80', 'backdrop-blur-md', 'border-b', 'border-gray-200');
        navbar.classList.add('bg-transparent');
    }
});

// Mobile Menu Toggle
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenu = document.getElementById('mobile-menu');
const mobileLinks = document.querySelectorAll('.mobile-link');

if (mobileMenuBtn && mobileMenu) {
    const hamburgerLines = mobileMenuBtn.querySelector('.hamburger-lines');

    mobileMenuBtn.addEventListener('click', () => {
        mobileMenu.classList.toggle('mobile-menu-open');
        if (hamburgerLines) {
            hamburgerLines.classList.toggle('open');
        }
    });

    // Close menu when a link is clicked
    mobileLinks.forEach(link => {
        link.addEventListener('click', () => {
            mobileMenu.classList.remove('mobile-menu-open');
            if (hamburgerLines) {
                hamburgerLines.classList.remove('open');
            }
        });
    });
}

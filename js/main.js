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

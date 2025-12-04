function renderHeader(config) {
    const headerContainer = document.getElementById('app-header');
    if (!headerContainer) return;

    const { logoHref, links } = config;

    const linksHtml = links.map(link => `
        <a href="${link.href}" class="hover:text-black transition-colors">${link.text}</a>
    `).join('');

    const mobileLinksHtml = links.map(link => `
        <a href="${link.href}" class="text-sm font-medium text-gray-600 hover:text-black transition-colors mobile-link">${link.text}</a>
    `).join('');

    headerContainer.innerHTML = `
    <nav id="navbar" class="fixed top-0 w-full z-50 transition-all duration-300 bg-transparent">
        <div class="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
            <a href="${logoHref}" class="text-xl font-semibold tracking-tight hover:opacity-70 transition-opacity">Adrian.</a>
            <div class="hidden md:flex space-x-8 text-xs font-medium text-gray-600">
                ${linksHtml}
            </div>
            <!-- Mobile Menu Button -->
            <button id="mobile-menu-btn" class="md:hidden text-gray-600 hover:text-black focus:outline-none p-2">
                <div class="hamburger-lines relative w-6 h-5">
                    <span class="line line1 absolute w-full h-0.5 bg-current rounded-full transition-all duration-300 ease-in-out top-0"></span>
                    <span class="line line2 absolute w-full h-0.5 bg-current rounded-full transition-all duration-300 ease-in-out top-1/2 -translate-y-1/2"></span>
                    <span class="line line3 absolute w-full h-0.5 bg-current rounded-full transition-all duration-300 ease-in-out bottom-0"></span>
                </div>
            </button>

            <div class="hidden md:flex items-center gap-4">
                <a href="Assets/CV/CV_ADRIAN%20YUSUFA%20RACHMAN.pdf" download
                    class="text-xs font-medium text-gray-600 hover:text-black transition-colors">
                    Download CV
                </a>
                <a href="mailto:adrian.y.rachman@gmail.com"
                    class="bg-black text-white text-xs px-4 py-1.5 rounded-full hover:bg-gray-800 transition-colors">
                    Get in Touch
                </a>
            </div>
        </div>

        <!-- Mobile Menu -->
        <div id="mobile-menu"
            class="md:hidden bg-white border-t border-gray-100 absolute w-full left-0 top-14 shadow-lg">
            <div class="flex flex-col px-6 py-4 space-y-4">
                ${mobileLinksHtml}
                <a href="Assets/CV/CV_ADRIAN%20YUSUFA%20RACHMAN.pdf" download
                    class="text-sm font-medium text-gray-600 hover:text-black transition-colors mobile-link">
                    Download CV
                </a>
                <a href="mailto:adrian.y.rachman@gmail.com"
                    class="text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors mobile-link">Get in
                    Touch</a>
            </div>
        </div>
    </nav>
    `;

    // Initialize Mobile Menu Logic
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
}

function renderFooter() {
    const footerContainer = document.getElementById('app-footer');
    if (!footerContainer) return;

    footerContainer.innerHTML = `
    <footer id="contact" class="bg-white border-t border-gray-200 py-12 px-6">
        <div class="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
            <div class="text-center md:text-left">
                <h3 class="text-xl font-bold mb-2">Let's work together!</h3>
                <p class="text-gray-500">Available for opportunities in iOS & Web Development.</p>
            </div>

            <div class="flex gap-6">
                <a href="mailto:adrian.y.rachman@gmail.com"
                    class="flex items-center gap-2 text-gray-600 hover:text-black transition-colors">
                    <i data-lucide="mail" class="w-5 h-5"></i>
                    <span>Email</span>
                </a>
                <a href="https://www.linkedin.com/in/adrian-rachman-432a60218/" target="_blank" rel="noreferrer"
                    class="flex items-center gap-2 text-gray-600 hover:text-blue-600 transition-colors">
                    <i data-lucide="linkedin" class="w-5 h-5"></i>
                    <span>LinkedIn</span>
                </a>
                <a href="https://github.com/Pupackted" target="_blank" rel="noreferrer"
                    class="flex items-center gap-2 text-gray-600 hover:text-black transition-colors">
                    <i data-lucide="github" class="w-5 h-5"></i>
                    <span>GitHub</span>
                </a>
            </div>
        </div>
        <div class="max-w-7xl mx-auto mt-12 pt-8 border-t border-gray-100 text-center text-xs text-gray-400">
           Last updated December 2025.
        </div>
    </footer>
    `;

    // Re-initialize icons for the footer
    if (window.lucide) {
        window.lucide.createIcons();
    }
}

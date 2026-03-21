// Mobile Menu Toggle
const menuBtn = document.getElementById('mobileMenuBtn');
const navRight = document.getElementById('navRight');

if (menuBtn && navRight) {
    menuBtn.addEventListener('click', () => {
        menuBtn.classList.toggle('change');
        navRight.classList.toggle('active');
    });
}

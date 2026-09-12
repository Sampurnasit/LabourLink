// LabourLink Client Helpers

document.addEventListener('DOMContentLoaded', () => {
  // 1. Phone number persistence
  const phoneInputs = document.querySelectorAll('input[type="tel"], input[name="phone_number"], input[name="employer_phone"], input[name="phone"]');
  
  // If we are on worker dashboard or employer dashboard without a phone query, check localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const currentPhone = urlParams.get('phone');

  if (window.location.pathname === '/worker/dashboard') {
    if (!currentPhone && localStorage.getItem('labourlink_worker_phone')) {
      const savedPhone = localStorage.getItem('labourlink_worker_phone');
      window.location.href = `/worker/dashboard?phone=${encodeURIComponent(savedPhone)}`;
      return;
    } else if (currentPhone) {
      localStorage.setItem('labourlink_worker_phone', currentPhone);
    }
  }

  if (window.location.pathname === '/employer/dashboard') {
    if (!currentPhone && localStorage.getItem('labourlink_employer_phone')) {
      const savedPhone = localStorage.getItem('labourlink_employer_phone');
      window.location.href = `/employer/dashboard?phone=${encodeURIComponent(savedPhone)}`;
      return;
    } else if (currentPhone) {
      localStorage.setItem('labourlink_employer_phone', currentPhone);
    }
  }

  // Pre-fill phone inputs if saved
  phoneInputs.forEach(input => {
    if (!input.value) {
      if (input.name === 'phone_number' || (input.name === 'phone' && window.location.pathname.includes('worker'))) {
        const saved = localStorage.getItem('labourlink_worker_phone');
        if (saved) input.value = saved;
      } else if (input.name === 'employer_phone' || (input.name === 'phone' && window.location.pathname.includes('employer'))) {
        const saved = localStorage.getItem('labourlink_employer_phone');
        if (saved) input.value = saved;
      }
    }

    input.addEventListener('input', (e) => {
      // Allow only digits
      e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 10);
    });
  });

  // Save phone number on form submissions
  const workerForm = document.querySelector('form[action="/worker/register"]');
  if (workerForm) {
    workerForm.addEventListener('submit', (e) => {
      const phone = workerForm.querySelector('input[name="phone_number"]').value;
      if (phone) localStorage.setItem('labourlink_worker_phone', phone);
    });
  }

  const employerForm = document.querySelector('form[action="/employer/post-job"]');
  if (employerForm) {
    employerForm.addEventListener('submit', (e) => {
      const phone = employerForm.querySelector('input[name="employer_phone"]').value;
      if (phone) localStorage.setItem('labourlink_employer_phone', phone);
    });
  }
});

// Toast notification helper
function showToast(message, type = 'success') {
  let toastContainer = document.getElementById('toast-container');
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'toast-container';
    toastContainer.style.position = 'fixed';
    toastContainer.style.bottom = '24px';
    toastContainer.style.right = '24px';
    toastContainer.style.zIndex = '9999';
    toastContainer.style.display = 'flex';
    toastContainer.style.flexDirection = 'column';
    toastContainer.style.gap = '8px';
    document.body.appendChild(toastContainer);
  }

  const toast = document.createElement('div');
  toast.className = `alert alert-${type}`;
  toast.style.boxShadow = '0 10px 15px -3px rgba(0,0,0,0.1)';
  toast.style.animation = 'fadeIn 0.2s ease-in-out';
  toast.innerText = message;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

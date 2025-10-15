/**
 * Submits a new report with form data including files.
 * @param {FormData} formData - The form data object, typically from an HTML <form> element.
 * It should contain fields like 'name', 'phone', 'complaint', 
 * 'latitude', 'longitude', and any audio/video files.
 */
async function submitNewReport(formData) {
  try {
    const response = await fetch('/api/submit', {
      method: 'POST',
      body: formData, // No 'Content-Type' header needed; browser sets it for FormData
    });

    const result = await response.json();

    if (result.success) {
      console.log('✅ Success:', result.message);
      alert('Your report has been submitted successfully!');
    } else {
      console.error('❌ Submission Failed:', result.error);
      alert('Error: ' + result.error);
    }
  } catch (error) {
    console.error('❌ Network or Server Error:', error);
    alert('A network error occurred. Please try again.');
  }
}

// --- Example Usage ---
// Assuming you have an HTML form with id="reportForm"
// const myForm = document.getElementById('reportForm');
// const formData = new FormData(myForm);
// submitNewReport(formData);

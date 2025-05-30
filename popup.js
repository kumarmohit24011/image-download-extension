document.getElementById('downloadBtn').addEventListener('click', async () => {
  const statusElement = document.getElementById('status');
  const progressBar = document.getElementById('progressBar');
  
  statusElement.textContent = 'Preparing to download...';
  progressBar.style.width = '0%';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Inject JSZip library into the page
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['jszip.min.js']
    });
    
    // Execute the main function
    const result = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: downloadAllImagesAsZip,
    });
    
    if (result[0].result.success) {
      statusElement.textContent = 'Download complete!';
      progressBar.style.width = '100%';
      
      // Create download link for the ZIP file
      const a = document.createElement('a');
      a.href = result[0].result.zipUrl;
      a.download = result[0].result.filename || 'images.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } else {
      statusElement.textContent = result[0].result.message || 'Download failed';
    }
  } catch (error) {
    statusElement.textContent = 'Error: ' + error.message;
    console.error(error);
  }
});

// This function runs in the webpage context
async function downloadAllImagesAsZip() {
  return new Promise(async (resolve) => {
    const images = Array.from(document.getElementsByTagName('img'));
    const totalImages = images.length;
    let processedCount = 0;
    let skippedCount = 0;
    
    if (totalImages === 0) {
      resolve({ success: false, message: 'No images found on this page.' });
      return;
    }
    
    const zip = new JSZip();
    const imgFolder = zip.folder("images");
    const domain = window.location.hostname.replace(/\./g, '_');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${domain}_images_${timestamp}.zip`;
    
    // Update progress function
    function updateProgress() {
      const percent = Math.round((processedCount / totalImages) * 100);
      chrome.runtime.sendMessage({
        action: 'updateProgress',
        percent: percent,
        processed: processedCount,
        total: totalImages
      });
    }
    
    // Process each image
    for (const [index, img] of images.entries()) {
      const src = img.src;
      
      // Skip if no valid src or data URL
      if (!src || src.startsWith('data:')) {
        skippedCount++;
        processedCount++;
        updateProgress();
        continue;
      }
      
      try {
        // Fetch the image
        const response = await fetch(src);
        if (!response.ok) throw new Error('Failed to fetch image');
        
        const blob = await response.blob();
        const url = new URL(src);
        let imageName = url.pathname.split('/').pop() || `image_${index + 1}`;
        
        // Ensure the filename has an extension
        if (!imageName.includes('.')) {
          // Try to determine extension from content type
          const extension = blob.type.split('/')[1] || 'jpg';
          imageName += `.${extension}`;
        }
        
        // Add to ZIP
        imgFolder.file(imageName, blob);
        processedCount++;
      } catch (error) {
        console.error(`Error processing image ${src}:`, error);
        skippedCount++;
        processedCount++;
      }
      
      updateProgress();
    }
    
    // Generate the ZIP file
    const content = await zip.generateAsync({ type: 'blob' });
    const zipUrl = URL.createObjectURL(content);
    
    resolve({
      success: true,
      zipUrl: zipUrl,
      filename: filename,
      message: `Processed ${processedCount} images (${processedCount - skippedCount} added to ZIP, ${skippedCount} skipped)`
    });
  });
}

// Handle progress updates from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updateProgress') {
    const statusElement = document.getElementById('status');
    const progressBar = document.getElementById('progressBar');
    
    progressBar.style.width = `${request.percent}%`;
    statusElement.textContent = 
      `Processing images... ${request.processed}/${request.total} (${request.percent}%)`;
  }
});
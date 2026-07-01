import { v2 as cloudinary } from 'cloudinary';

// 1. Configure Cloudinary using your credentials
cloudinary.config({
  cloud_name: 'atavzoax',
  api_key: '895225877495757',
  api_secret: 'AHCke3Nu_pOCH3LmEpCSOtszJXU'
});

async function runCloudinaryScript() {
  try {
    console.log("Uploading sample image...");
    
    // 2. Upload an image from Cloudinary's demo domain
    const uploadResult = await cloudinary.uploader.upload('https://res.cloudinary.com/demo/image/upload/sample.jpg', {
      public_id: 'my_first_demo_upload'
    });

    console.log("Upload successful!\n");
    console.log("Secure URL:", uploadResult.secure_url);
    console.log("Public ID:", uploadResult.public_id);

    // 3. Get image details
    console.log("\n--- Image Details ---");
    console.log("Width:", uploadResult.width);
    console.log("Height:", uploadResult.height);
    console.log("Format:", uploadResult.format);
    console.log("Size (bytes):", uploadResult.bytes);

    // 4. Transform the image
    // f_auto: Automatically formats the image to the most efficient format for the browser
    // q_auto: Automatically adjusts the compression quality to minimize file size without visible degradation
    const transformedUrl = cloudinary.url(uploadResult.public_id, {
      fetch_format: 'auto',
      quality: 'auto'
    });

    console.log("\nDone! Click link below to see optimized version of the image. Check the size and the format.");
    console.log(transformedUrl);

  } catch (error) {
    console.error("Upload Error:", error);
  }
}

runCloudinaryScript();
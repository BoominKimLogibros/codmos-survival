const vendorBase = `${import.meta.env.BASE_URL}vendor/`;

function loadVendor(filename: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `${vendorBase}${filename}`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load local vendor file: ${filename}`));
    document.head.appendChild(script);
  });
}

try {
  await loadVendor('phaser.min.js');
  await loadVendor('SpinePlugin.js');
  await import('./main');
} catch (error) {
  console.error(error);
  const message = document.createElement('div');
  message.id = 'startup-error';
  message.textContent = '게임의 로컬 실행 파일을 불러오지 못했습니다.';
  document.body.appendChild(message);
}

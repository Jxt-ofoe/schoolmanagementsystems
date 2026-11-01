import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Normalizes phone number to international format for WhatsApp (e.g. Ghana 233...)
 */
export function formatWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let digits = String(phone).replace(/[^0-9]/g, '');
  if (!digits) return null;

  if (digits.length === 10 && digits.startsWith('0')) {
    digits = '233' + digits.substring(1);
  }
  if (digits.length === 9) {
    digits = '233' + digits;
  }
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

/**
 * Generates a direct WhatsApp sharing URL with pre-filled message.
 */
export function createWhatsAppLink(phone: string, message: string): string {
  const cleanPhone = formatWhatsAppNumber(phone);
  const encodedText = encodeURIComponent(message);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Converts a DOM element (the report card container) into a high-resolution A4 PDF.
 */
export async function generateReportCardPdf(
  element: HTMLElement,
  filename = 'Student_Terminal_Report.pdf'
): Promise<{ blob: Blob; filename: string }> {
  // Capture canvas with 2x scale for crisp print quality
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: '#ffffff',
    windowWidth: 1024,
  });

  const imgData = canvas.toDataURL('image/jpeg', 0.95);
  
  // Create jsPDF in standard A4 portrait (210mm x 297mm)
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgWidth = pdfWidth - 16; // 8mm margins on each side
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  // Center vertically if it fits on one page, or print from top margin
  const yOffset = imgHeight < pdfHeight ? 8 : 4;
  pdf.addImage(imgData, 'JPEG', 8, yOffset, imgWidth, Math.min(imgHeight, pdfHeight - 16));

  const blob = pdf.output('blob');
  return { blob, filename };
}

/**
 * Triggers browser download of a PDF blob.
 */
export function downloadPdfBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * Executes the manual WhatsApp sharing workflow:
 * 1. Downloads the PDF to teacher's device
 * 2. Opens WhatsApp link in a new tab/app with pre-filled parent message
 * 3. Supports mobile Web Share API with file attachment if supported
 */
export async function executeManualWhatsAppShare({
  element,
  parentPhone,
  studentName,
  schoolName,
  customMessage,
  onStatusChange,
}: {
  element: HTMLElement;
  parentPhone: string;
  studentName: string;
  schoolName: string;
  customMessage?: string;
  onStatusChange?: (status: 'generating' | 'downloaded' | 'opened') => void;
}): Promise<void> {
  onStatusChange?.('generating');

  const cleanFilename = `Report_Card_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
  const { blob } = await generateReportCardPdf(element, cleanFilename);
  onStatusChange?.('downloaded');

  const defaultMsg = `Dear Parent, the official examination report card for ${studentName} is ready. Please find the attached PDF report card from ${schoolName}. Thank you.`;
  const messageToSend = customMessage?.trim() || defaultMsg;

  // Try Web Share API (native mobile sharing with file support)
  if (navigator.canShare && navigator.canShare({ files: [new File([blob], cleanFilename, { type: 'application/pdf' })] })) {
    try {
      const file = new File([blob], cleanFilename, { type: 'application/pdf' });
      await navigator.share({
        title: `${studentName} Terminal Report Card`,
        text: messageToSend,
        files: [file],
      });
      onStatusChange?.('opened');
      return;
    } catch (err: any) {
      if (err.name === 'AbortError') return; // User cancelled share sheet
      // Fallback to download + wa.me URL
    }
  }

  // Desktop or standard fallback: download file & open WhatsApp
  downloadPdfBlob(blob, cleanFilename);

  const waLink = createWhatsAppLink(parentPhone, messageToSend);
  onStatusChange?.('opened');
  window.open(waLink, '_blank', 'noopener,noreferrer');
}

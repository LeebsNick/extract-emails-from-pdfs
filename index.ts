import * as glob from 'glob';
import * as async from 'async';
import * as path from 'path';
import extractEmail from 'extract-email-address';
import * as fs from 'fs-extra';
import { flattenDeep, uniq } from 'lodash';
import pdf from 'pdf-poppler';
import tesseract from 'node-tesseract-ocr';
import cliProgress from 'cli-progress';

async function extractEmailFromPdfs(pdfRootPath: string) {
	const progressBar = new cliProgress.SingleBar({
		format: 'progress [{bar}] {percentage}% | ETA: {eta}s | {step}'
	}, cliProgress.Presets.shades_classic);
	progressBar.start(100, 0, {
		step: 'Finding pdf files'
	});

	const pdfFilePaths = await findPdfFiles(pdfRootPath);

	progressBar.update(5, {
		step: 'Converting pdfs to images'
	});
	const pngFilePaths = await convertPdfsToPngs(pdfFilePaths, progressBar);

	progressBar.update(50, {
		step: 'Extracting text from images'
	});
	const texts = await extractTextFromImages(pngFilePaths, progressBar);

	progressBar.update(96, {
		step: 'Extracting email addresses from images'
	});
	const emails = extractEmailAddressesFromTexts(texts);

	progressBar.update(98, {
		step: 'Write email addresses to file'
	});
	await fs.writeFile('emails.txt', emails.join('\n'));



	progressBar.update(100, {
		step: 'Write email addresses to file'
	});
	progressBar.stop();
	console.log(`finished, wrote ${emails.length} email addresses to emails.txt`);
}

function findPdfFiles(pdfRootPath: string) {
	return new Promise<string[]>((resolve, reject) => {
		glob.glob(path.join(pdfRootPath, '**/*.pdf'), {}, async function (err, files) {
			if (err) {
				reject(err);
			} else {
				resolve(files.map(filePath => path.join(__dirname, filePath)));
			}
		});
	});
}

async function convertPdfsToPngs(pdfFilePaths: string[], progressBar: cliProgress.SingleBar): Promise<string[]> {
	let finished = 0;

	return await async.mapLimit(pdfFilePaths, 10, async (pdfPath) => {
		const pngPath = pdfPath
			.replace(/([\\\/])pdfs[\\\/]/, '$1pngs$1')
			.replace(/\.pdf$/, '.png');

		const outputPath = await convertPdfToPng(
			pdfPath,
			pngPath,
		);
		finished++;
		progressBar.update(Math.round(5 + 45 * (finished / pdfFilePaths.length)), {
			step: 'Converting pdfs to images'
		});
		return outputPath;
	});
}

async function convertPdfToPng(pdfPath: string, pngPath: string): Promise<string> {
	const finalPngPath = pngPath.replace(/\.png$/, '-1.png');

	if (await fs.pathExists(finalPngPath)) {
		return finalPngPath;
	}

	await fs.ensureDir(path.dirname(pngPath));

	let opts = {
		format: 'png',
		scale: '3000',
		out_dir: path.dirname(pngPath),
		out_prefix: path.basename(pngPath, path.extname(pngPath)),
		page: null
	};

	await pdf.convert(pdfPath, opts);
	return finalPngPath;
}

async function extractTextFromImages(imagePaths: string[], progressBar: cliProgress.SingleBar): Promise<string[]> {
	let finished = 0;
	return async.mapLimit(imagePaths, 10, async (imagePath) => {
		const text = await extractTextFromImage(imagePath);
		finished++;
		progressBar.update(Math.round(50 + 45 * finished / imagePaths.length), {
			step: 'Extracting text from images'
		});
		return text;
	});
}

async function extractTextFromImage(imagePath: string): Promise<string> {
	const config = {
		lang: 'eng',
		oem: 1,
		psm: 3,
		binary: path.join(__dirname, 'Tesseract-OCR/tesseract.exe'),
	};

	return await tesseract.recognize(imagePath, config);
}

function extractEmailAddressesFromTexts(texts: string[]): string[] {
	try {
		const addresses: string[] = texts.map((text: string): string => {
			const emailInfoArray = extractEmail(text);
			return (emailInfoArray || []).map((emailResponse: { email: string }) => emailResponse.email);
		});
		const cleanAddresses = flattenDeep(addresses);
		return uniq(cleanAddresses).sort();
	} catch (err) {
		throw new Error('Failed to extract email addresses from texts: ' + JSON.stringify(err));
	}
}

extractEmailFromPdfs('./pdfs')
	.then(() => console.log('done'))
	.catch((err) => console.log('failed to extract emails from pdfs: ', err));

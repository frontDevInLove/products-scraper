import puppeteer, {Page, Browser} from 'puppeteer';
import * as cheerio from 'cheerio';
import translate from "translate";
import * as fs from "fs";
import * as path from "path";

function delay(time: number = 1000): Promise<void> {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

type BrowserControl = {browser: Browser, page: Page};
async function loadAllProducts(): Promise<BrowserControl> {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  // Размер экрана
  await page.setViewport({ width: 1080, height: 1024 });

  await page.goto('https://www.gardena.com/int/products/soil-ground/combisystem');

  // Селектор кнопки "Показать больше"
  const loadMoreButtonSelector = '#products-accessories > div > div.grid-footer.row.m-0.p-0 > div.show-more > div > a';

  // Функция для проверки видимости кнопки "Показать больше"
  const isLoadMoreButtonVisible = async (page: Page, selector: string): Promise<boolean> => {
    return await page.evaluate((selector) => {
      const loadMoreButton = document.querySelector(selector);
      return loadMoreButton !== null;
    }, selector);
  };

  // Ждем, пока страница полностью загрузится
  const cookieButtonSelector = '#onetrust-accept-btn-handler';
  await page.waitForSelector(cookieButtonSelector);
  await page.click(cookieButtonSelector);

  // Кликаем по кнопке "Показать больше", пока она видима
  let loadMoreButtonVisible = await isLoadMoreButtonVisible(page, loadMoreButtonSelector);
  while (loadMoreButtonVisible) {
    await page.click(loadMoreButtonSelector);
    await delay();
    loadMoreButtonVisible = await isLoadMoreButtonVisible(page, loadMoreButtonSelector);
  }

  console.log('все загрузил');

  return {browser, page};
}

interface ProductData {
  link: string;
  image: string;
  nameEn: string; // Название на английском языке
  nameRu: string; // Название на русском языке
  articleNumber: string;
}

async function collectProductData(page: Page): Promise<ProductData[]> {
  const htmlContent = await page.content();
  const $ = cheerio.load(htmlContent);
  const baseUrl = 'https://www.gardena.com';

  const products = $('.product').map((index, element) => {
    const link = baseUrl + ($(element).find('a').attr('href') || '');
    const imageSrc = $(element).find('img').attr('src') || '';
    const image = imageSrc.startsWith('//') ? 'https:' + imageSrc : imageSrc;
    const nameEn = $(element).find('h4').text(); // Оригинальное название на английском
    const articleNumber = $(element).find('.article-number').text().trim().replace('Article No. ', '');
    return { link, image, nameEn, articleNumber, nameRu: '' };
  }).get();

  return Promise.all(products.map(async product => ({
    ...product,
    nameRu: await translate(product.nameEn, { to: 'ru' }), // Перевод названия на русский
  })));
}

async function downloadImage(page: Page, imageUrl: string, savePath: string): Promise<void> {
  const viewSource = await page.goto(imageUrl);
  if (viewSource) {
    fs.writeFileSync(savePath, await viewSource.buffer());
  }
}

async function saveProductData(browser: Browser, products: ProductData[]): Promise<void> {
  const buildDir = path.join(__dirname, 'build');

  // Удаление папки build, если она существует
  if (fs.existsSync(buildDir)) {
    fs.rmSync(buildDir, { recursive: true, force: true });
  }

  // Создание папки build
  fs.mkdirSync(buildDir);

  // Обработка каждого товара
  for (const product of products) {
    const productDirName = `${product.nameRu.replace(/[\/\\?%*:|"<>]/g, '_')}_${product.articleNumber}`;
    const productDir = path.join(buildDir, productDirName);
    fs.mkdirSync(productDir);

    const page = await browser.newPage();

    // Скачивание и сохранение изображения
    const imageFilePath = path.join(productDir, 'image.png');
    if (product.image.startsWith('http')){
      await downloadImage(page, product.image , imageFilePath);
    }

    await page.close();

    // Создание и сохранение CSV файла
    const csvContent = `Link,Image,Name EN,Name RU,Article Number\n"${product.link}","${imageFilePath}","${product.nameEn}","${product.nameRu}","${product.articleNumber}"`;
    const csvFilePath = path.join(productDir, 'data.csv');
    fs.writeFileSync(csvFilePath, csvContent);
  }
}

const main = async ():  Promise<void> => {
  const {browser, page} = await loadAllProducts();
  const products = await collectProductData(page);
  await saveProductData(browser, products);
  await browser.close();
}

main();

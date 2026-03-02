declare module "cheerio" {
  type EachCallback = (index: number, element: unknown) => void;

  type Collection = {
    each(callback: EachCallback): Collection;
    text(): string;
  };

  type Root = {
    (selectorOrElement: string | unknown): Collection;
  };

  export function load(html: string): Root;
}

declare module "robots-parser" {
  type Robots = {
    isAllowed(url: string, userAgent?: string): boolean | undefined;
  };

  export default function robotsParser(url: string, contents: string): Robots;
}

import type { CSSProperties, ImgHTMLAttributes } from "react";

// Minimal stand-in for `next/image` so the funnel components copy over unchanged.
// Renders a plain <img>, swallowing the Next-only props (priority/unoptimized/
// fill/loader/...). `fill` maps to absolute full-bleed positioning like Next does.
type NextImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "width" | "height"> & {
	src: string;
	alt?: string;
	width?: number | string;
	height?: number | string;
	priority?: boolean;
	unoptimized?: boolean;
	fill?: boolean;
	quality?: number;
	loader?: unknown;
	placeholder?: string;
	blurDataURL?: string;
	sizes?: string;
};

export default function Image({
	src,
	alt = "",
	width,
	height,
	priority: _priority,
	unoptimized: _unoptimized,
	fill,
	quality: _quality,
	loader: _loader,
	placeholder: _placeholder,
	blurDataURL: _blurDataURL,
	style,
	...rest
}: NextImageProps) {
	const fillStyle: CSSProperties | undefined = fill
		? { position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }
		: undefined;

	return (
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={src}
			alt={alt}
			width={fill ? undefined : (width as number | undefined)}
			height={fill ? undefined : (height as number | undefined)}
			style={{ ...fillStyle, ...style }}
			{...rest}
		/>
	);
}

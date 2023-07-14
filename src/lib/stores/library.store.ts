import {
	getJellyfinContinueWatching,
	getJellyfinItem,
	getJellyfinItems,
	type JellyfinItem
} from '$lib/apis/jellyfin/jellyfinApi';
import {
	getRadarrDownloads,
	getRadarrMovies,
	type RadarrDownload,
	type RadarrMovie
} from '$lib/apis/radarr/radarrApi';
import {
	getSonarrDownloads,
	getSonarrSeries,
	type SonarrDownload,
	type SonarrSeries
} from '$lib/apis/sonarr/sonarrApi';
import {
	fetchTmdbMovieImages,
	getTmdbIdFromTvdbId,
	getTmdbSeriesFromTvdbId,
	getTmdbSeriesImages
} from '$lib/apis/tmdb/tmdbApi';
import { writable } from 'svelte/store';

interface PlayableItem {
	cardBackdropUrl: string;
	download?: {
		progress: number;
		completionTime: string;
	};
	continueWatching?: {
		progress: number;
		length: number;
	};
	isPlayed: boolean;
	jellyfinId?: string;
}

export interface PlayableRadarrMovie extends RadarrMovie, PlayableItem {}
export interface PlayableSonarrSeries extends SonarrSeries, PlayableItem {
	tmdbId?: number;
	tmdbRating: number;
}

export interface Library {
	movies: PlayableRadarrMovie[];
	totalMovies: number;
	series: PlayableSonarrSeries[];
	totalSeries: number;
	getMovie: (tmdbId: number) => PlayableRadarrMovie | undefined;
	getSeries: (tmdbId: number) => PlayableSonarrSeries | undefined;
}

async function getLibrary(): Promise<Library> {
	const radarrMoviesPromise = getRadarrMovies();
	const radarrDownloadsPromise = getRadarrDownloads();

	const sonarrSeriesPromise = getSonarrSeries();
	const sonarrDownloadsPromise = getSonarrDownloads();

	const continueWatchingPromise = getJellyfinContinueWatching();
	const jellyfinLibraryItemsPromise = getJellyfinItems();

	const movies: PlayableRadarrMovie[] = await radarrMoviesPromise.then(async (radarrMovies) => {
		const radarrDownloads = await radarrDownloadsPromise;
		const continueWatching = await continueWatchingPromise;
		const jellyfinItems = await jellyfinLibraryItemsPromise;

		return getLibraryMovies(radarrMovies, radarrDownloads, continueWatching, jellyfinItems);
	});

	const series: PlayableSonarrSeries[] = await sonarrSeriesPromise.then(async (sonarrSeries) => {
		const sonarrDownloads = await sonarrDownloadsPromise;
		const continueWatching = await continueWatchingPromise;
		const jellyfinItems = await jellyfinLibraryItemsPromise;

		return getLibrarySeries(sonarrSeries, sonarrDownloads, continueWatching, jellyfinItems);
	});

	return {
		movies,
		totalMovies: movies?.length || 0,
		series,
		totalSeries: series?.length || 0,
		getMovie: (tmdbId: number) => movies.find((m) => m.tmdbId === tmdbId),
		getSeries: (tmdbId: number) => series.find((s) => s.tmdbId === tmdbId)
	};
}

export const library = writable<Promise<Library>>(getLibrary());

async function getLibraryMovies(
	radarrMovies: RadarrMovie[],
	radarrDownloads: RadarrDownload[],
	jellyfinContinueWatching: JellyfinItem[],
	jellyfinItems: JellyfinItem[]
): Promise<PlayableRadarrMovie[]> {
	const playableMoviesPromises = radarrMovies.map(async (m) => {
		const radarrDownload = radarrDownloads.find((d) => d.movie.tmdbId === m.tmdbId);
		const jellyfinItem = jellyfinItems.find((i) => i.ProviderIds?.Tmdb === String(m.tmdbId));

		const downloadProgress =
			radarrDownload?.sizeleft && radarrDownload?.size
				? ((radarrDownload.size - radarrDownload.sizeleft) / radarrDownload.size) * 100
				: undefined;
		const completionTime = radarrDownload?.estimatedCompletionTime || undefined;
		const download =
			downloadProgress && completionTime
				? { progress: downloadProgress, completionTime }
				: undefined;

		const length = jellyfinItem?.RunTimeTicks
			? jellyfinItem.RunTimeTicks / 10_000_000 / 60
			: undefined;
		const watchingProgress = jellyfinItem?.UserData?.PlayedPercentage;
		const continueWatching =
			length &&
			watchingProgress &&
			!!jellyfinContinueWatching.find((i) => i.Id === jellyfinItem?.Id)
				? { length, progress: watchingProgress }
				: undefined;

		const backdropUrl = await fetchTmdbMovieImages(String(m.tmdbId)).then(
			(r) => r.backdrops.find((b) => b.iso_639_1 === 'en')?.file_path
		);

		return {
			...m,
			cardBackdropUrl: backdropUrl || '',
			download,
			continueWatching,
			isPlayed: jellyfinItem?.UserData?.Played || false,
			jellyfinId: jellyfinItem?.Id
		};
	});

	return await Promise.all(playableMoviesPromises);
}

async function getLibrarySeries(
	sonarrSeries: SonarrSeries[],
	sonarrDownloads: SonarrDownload[],
	jellyfinContinueWatching: JellyfinItem[],
	jellyfinItems: JellyfinItem[]
): Promise<PlayableSonarrSeries[]> {
	const playableSeriesPromises = sonarrSeries.map(async (s) => {
		const sonarrDownload = sonarrDownloads.find((d) => d.series.tvdbId === s.tvdbId);
		const jellyfinItem = jellyfinItems.find((i) => i.ProviderIds?.Tvdb === String(s.tvdbId));

		const downloadProgress =
			sonarrDownload?.sizeleft && sonarrDownload?.size
				? ((sonarrDownload.size - sonarrDownload.sizeleft) / sonarrDownload.size) * 100
				: undefined;
		const completionTime = sonarrDownload?.estimatedCompletionTime || undefined;
		const download =
			downloadProgress && completionTime
				? { progress: downloadProgress, completionTime }
				: undefined;

		const length = jellyfinItem?.RunTimeTicks
			? jellyfinItem.RunTimeTicks / 10_000_000 / 60
			: undefined;
		const watchingProgress = jellyfinItem?.UserData?.PlayedPercentage;
		const continueWatching =
			length &&
			watchingProgress &&
			!!jellyfinContinueWatching.find((i) => i.Id === jellyfinItem?.Id)
				? { length, progress: watchingProgress }
				: undefined;

		const tmdbItem = s.tvdbId ? await getTmdbSeriesFromTvdbId(s.tvdbId) : undefined;
		const tmdbId = tmdbItem?.id || undefined;

		const backdropUrl = tmdbId
			? await getTmdbSeriesImages(tmdbId).then(
					(r) => r?.backdrops?.find((b) => b.iso_639_1 === 'en')?.file_path
			  )
			: undefined;

		return {
			...s,
			tmdbId,
			cardBackdropUrl: backdropUrl || '',
			download,
			continueWatching,
			isPlayed: jellyfinItem?.UserData?.Played || false,
			tmdbRating: tmdbItem.vote_average || 0,
			jellyfinId: jellyfinItem?.Id
		};
	});

	return await Promise.all(playableSeriesPromises);
}
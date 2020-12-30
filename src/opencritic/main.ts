import { OCClient } from './OCClient'

export { OCClient }

export interface OCGame {
    reviewSummary: OCReviewSummary,
    mastheadScreenshot: OCImage,
    logoScreenshot: OCImage,
    bannerScreenshot: OCImage,
    mainChannel: OCChannel,
    newsSearchEnabled: boolean,
    type: string,
    Skus: string[],
    percentRecommended: number,
    numReviews: number,
    numTopCriticReviews: number,
    numUserReviews: number,
    medianScore: number,
    averageScore: number,
    topCriticScore: number,
    percentile: number,
    tier: string,
    hasLootBoxes: boolean,
    isMajorTitle: boolean,
    name: string,
    screenshots: OCImage[],
    trailers: OCTrailer[],
    Companies: OCCompany[],
    Platforms: OCPlatformRelease[],
    Genres: OCGenre[],
    id: number,
    firstReleaseDate: Date,
    createdAt: Date,
    updatedAt: Date,
    description: string,
    firstReviewDate: Date,
    latestReviewDate: Date
}

export interface OCGenre {
    id: number,
    name: string
}

export interface OCPlatform {
    id: number,
    name: string,
    shortName: string,
    imageSrc: string
}

export interface OCPlatformRelease extends OCPlatform {
    releaseDate: Date
}

export interface OCCompany {
    name: string,
    type: "DEVELOPER" | "PUBLISHER"
}

export interface OCImage {
    fullRes: string,
    thumbnail: string
}

export interface OCTrailer extends OCChannelResource {
    publishedDate: Date,
    videoId: string,
    lastRefreshDate: Date
}

export interface OCChannelResource {
    channelId: string,
    channelTitle: string,
    description: string,
    title: string,
    externalUrl: string
}

export interface OCChannel extends OCChannelResource {
    image: string
}

export interface OCReviewSummary {
    completed: boolean,
    summary: string,
    slot1: string,
    slot1State: "pro" | "con",
    slot1P: string,
    slot2: string,
    slot2State: "pro" | "con",
    slot2P: string,
    slot3: string,
    slot3State: "pro" | "con",
    slot3P: string,
}

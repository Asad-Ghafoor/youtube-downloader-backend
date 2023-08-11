const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');
const ytdl = require('ytdl-core');
const bodyParser = require('body-parser');
const fs = require('fs');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffmpeg = require('fluent-ffmpeg');

require('dotenv').config();
require('./conn/db');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());
app.use(morgan('dev'));

function sanitizeTitle(title) {
    return title.replace(/[^\w\s]/gi, '').replace(/\s+/g, '_');
}

app.get('/download', async (req, res) => {
    const { videoURL } = req.query;
    try {
        if (!ytdl.validateURL(videoURL)) {
            throw new Error('Invalid YouTube URL');
        }
        const info = await ytdl.getInfo(videoURL);

        const format = ytdl.chooseFormat(info.formats, { quality: 'highest' });
        if (format.container !== 'mp4') {
            throw new Error('Invalid video format. Only MP4 format is supported.');
        }
        const contentLength = format.contentLength;
        if (contentLength && contentLength > 1000 * 1024 * 1024) {
            throw new Error('The video size exceeds 1000 MB.');
        }

        const sanitizedTitle = sanitizeTitle(info.videoDetails.title);
        const uniqueId = Date.now();
        const publicDir = path.join(__dirname, 'public');
        const videosDir = path.join(publicDir, 'videos');
        if (!fs.existsSync(publicDir)) {
            fs.mkdirSync(publicDir);
        }
        if (!fs.existsSync(videosDir)) {
            fs.mkdirSync(videosDir);
        }
        const filePath = path.join(videosDir, `${sanitizedTitle}-${uniqueId}.mp4`);
        const videoStream = ytdl(videoURL, { format });

        videoStream.on('error', (error) => {
            console.error('Error while downloading video:', error.message);
            res.status(500).send({ error: 'An error occurred while downloading the video.' });
        });

        videoStream.pipe(fs.createWriteStream(filePath));
        videoStream.on('end', async () => {
            try {
                const thumbnailUrl = info.videoDetails.thumbnails[0].url;
                const responseObj = {
                    videoTitle: info.videoDetails.title,
                    videoThumbnail: thumbnailUrl,
                    videoUrl: `${sanitizedTitle}-${uniqueId}.mp4`
                };
                res.json(responseObj);
                const previousVideoPath = path.join(videosDir, `${sanitizedTitle}-*.mp4`);
                const files = await fs.promises.readdir(videosDir);
                const previousVideos = files.filter(file => file.startsWith(`${sanitizedTitle}-`) && file.endsWith('.mp4') && file !== `${sanitizedTitle}-${uniqueId}.mp4`);
                for (const prevVideo of previousVideos) {
                    await fs.promises.unlink(path.join(videosDir, prevVideo));
                }
            } catch (error) {
                console.error('Error while reading the video file:', error.message);
                res.status(500).send({ error: 'An error occurred while processing the video.' });
            }
        });
    } catch (error) {
        console.error('Error while processing the request:', error.message);
        res.status(500).send({ error: error.message });
    }
});



const publicAudiosFolder = path.join(__dirname, 'public', 'audios');

app.get('/downloadmp3', async (req, res) => {
    const { AudioURL } = req.query;

    try {
        const info = await ytdl.getInfo(AudioURL);
        const title = info.title;
        const thumbnail = info.player_response.videoDetails.thumbnail.thumbnails.pop().url;
        const sanitizedTitle = sanitizeTitle(info.videoDetails.title);
        const timestamp = new Date().getTime();
        const uniqueFileName = `${timestamp}-${sanitizedTitle}}.mp3`; // Generate a unique filename with timestamp
        const audioPath = path.join(publicAudiosFolder, uniqueFileName);

        const audioStream = ytdl(AudioURL, { quality: 'highestaudio' }).on('error', (error) => {
            console.error('Error fetching audio:', error);
            res.status(500).json({ error: 'Error fetching audio' });
        });

        ffmpeg(audioStream)
            .setFfmpegPath(ffmpegInstaller.path)
            .toFormat('mp3')
            .on('end', () => {
                console.log('Audio conversion completed!');
                res.status(200).json({ title: info.videoDetails.title, thumbnail, uniqueFileName }); // Send the unique filename to the front end
            })
            .on('error', (error) => {
                console.error('Error converting audio:', error);
                res.status(500).json({ error: 'Error converting audio' });
            })
            .save(audioPath); // Save the audio with the unique filename
    } catch (error) {
        console.error('Error fetching YouTube Audio:', error);
        res.status(500).json({ error: 'Error fetching YouTube Audio' });
    }
});



app.use('/getvideo', express.static('public/videos'));
app.use('/getaudio', express.static('public/audios'));


const port = process.env.PORT || 3001;

app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
/* tslint:disable */
// Copyright 2024 Google LLC

// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at

//     https://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import c from 'classnames';
// FIX: Add DragEvent for typing drop events, and Type for Gemini file types.
import {useEffect, useRef, useState, DragEvent, ChangeEvent} from 'react';
import {generateContent, uploadFile} from './api';
import functions from './functions';
import modes from './modes';
import {timeToSecs} from './utils';
import VideoPlayer from './VideoPlayer.jsx';

const MODE_SEO = 'SEO Описание';

// FIX: The `Type.Blob` is an incorrect type. The `Type` enum from `@google/genai` is for
// function calling schema definitions and does not have a `Blob` property.
// It has been replaced with `any` to correctly type the Gemini file object.
interface VideoFileEntry {
  id: string;
  name: string;
  url: string;
  file: File;
  geminiFile: any | null;
  uploadError: string | null;
  // Persistence fields
  seoData?: { title: string; russianTitle: string; keywords: string };
  textResponse?: string | null;
  timecodeList?: any[] | null;
}

export default function App() {
  // FIX: Add types to useState hooks for better type safety.
  // Removed separate state for vidUrl and file to fix synchronization issues
  const [videoFiles, setVideoFiles] = useState<VideoFileEntry[]>([]); // {id, name, url, file, geminiFile, uploadError}
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [timecodeList, setTimecodeList] = useState<any[] | null>(null);
  const [textResponse, setTextResponse] = useState<string | null>(null);
  const [requestedTimecode, setRequestedTimecode] = useState<number | null>(
    null,
  );
  const [selectedMode, setSelectedMode] = useState<string>(
    Object.keys(modes)[0],
  );
  const [activeMode, setActiveMode] = useState<string>();
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [seoData, setSeoData] = useState({
    title: '',
    russianTitle: '',
    keywords: '',
  });
  const [copiedPart, setCopiedPart] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [isCorrecting, setIsCorrecting] = useState(false);
  
  // New state for additional inputs
  const [additionalText, setAdditionalText] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);

  const [theme] = useState(
    window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light',
  );
  // FIX: Type useRef and handle potential null value for the ref.
  const scrollRef = useRef<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Derived state
  const activeVideo = activeVideoId ? videoFiles.find((v) => v.id === activeVideoId) : null;
  const vidUrl = activeVideo?.url || null;
  const file = activeVideo?.geminiFile || null;

  useEffect(() => {
    if (!activeVideo) {
      // Handle case where active video was deleted or ID is invalid
      if (activeVideoId && videoFiles.length > 0) {
          const first = videoFiles[0];
          setActiveVideoId(first.id);
      }
      return;
    }
      
    // Restore persisted data
    if (activeVideo.seoData && (activeVideo.seoData.title || activeVideo.seoData.keywords)) {
      setSeoData(activeVideo.seoData);
      setTextResponse(activeVideo.textResponse || null);
      setActiveMode(MODE_SEO);
    } else if (activeVideo.timecodeList) {
      setTimecodeList(activeVideo.timecodeList);
      setTextResponse(null);
      setActiveMode('Аудио/Видео субтитры'); // Infer mode or store it
      setSeoData({title: '', russianTitle: '', keywords: ''});
    } else {
      // Reset if no data
      setTimecodeList(null);
      setTextResponse(null);
      setSeoData({title: '', russianTitle: '', keywords: ''});
      setActiveMode(undefined);
    }
    setCorrectionText('');
  }, [activeVideoId, activeVideo]); 

  const setTimecodes = ({timecodes}: {timecodes: any[]}) => {
    const processed = timecodes.map((t) => ({...t, text: t.text.replaceAll("\\'", "'")}));
    setTimecodeList(processed);
    // Persist
    setVideoFiles(prev => prev.map(v => v.id === activeVideoId ? {...v, timecodeList: processed} : v));
  };

  const parseSeoResponse = (text: string | null) => {
    if (!text) return {title: '', russianTitle: '', keywords: ''};

    const clean = (str: string | undefined) =>
      (str || '').replace(/\*/g, '').trim();

    const allHeaders = [
      'Заголовок',
      'Title',
      'Russian Title',
      'Русский заголовок',
      'Ключевые слова',
      'Keywords',
    ];

    const getSectionContent = (currentHeaders: string[]) => {
      const lookaheadHeaders = allHeaders.filter(
        (h) => !currentHeaders.some((ch) => h.toLowerCase() === ch.toLowerCase()),
      );

      const regex = new RegExp(
        `\\**\\s*(?:${currentHeaders.join('|')})\\**\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\**\\s*(?:${lookaheadHeaders.join('|')})\\**\\s*:|$)`,
        'i',
      );

      const match = text.match(regex);
      return match ? clean(match[1]) : '';
    };

    const title = getSectionContent(['Заголовок', 'Title']);
    const russianTitle = getSectionContent([
      'Russian Title',
      'Русский заголовок',
    ]);
    let keywords = getSectionContent(['Ключевые слова', 'Keywords']);

    if (!title && !keywords && !russianTitle) {
      if (
        !allHeaders.some((h) =>
          new RegExp(`\\**\\s*${h}\\**\\s*:`, 'i').test(text),
        )
      ) {
        keywords = clean(text);
      }
    }

    return {title, russianTitle, keywords};
  };

  useEffect(() => {
    if (activeMode === MODE_SEO && textResponse) {
      // Optimization: Only parse if we need to display it and it's not coming from a persisted state we just set
      // But for simplicity, parsing again is cheap.
      // We do NOT call setSeoData here to avoid loops if setSeoData triggers something,
      // but strictly speaking, textResponse is the source of truth for current display.
      const parsed = parseSeoResponse(textResponse);
      // Only set if different to avoid potential render loops if object identity changes
      if (parsed.title !== seoData.title || parsed.keywords !== seoData.keywords) {
         setSeoData(parsed);
      }
    }
  }, [textResponse, activeMode]);

  const handleCopy = (text: string, part: string) => {
    navigator.clipboard.writeText(text);
    setCopiedPart(part);
    setTimeout(() => setCopiedPart(null), 2000); // Reset after 2 seconds
  };

  const onModeSelect = async (mode: string) => {
    setActiveMode(mode);
    setIsLoading(true);
    // Clear current view
    setTimecodeList(null);
    setTextResponse(null);
    setCorrectionText('');
    setSeoData({title: '', russianTitle: '', keywords: ''});

    const modeConfig = modes[mode];
    const isTextMode = modeConfig.isText;
    let basePrompt = modeConfig.prompt;

    // Append additional text if present
    if (additionalText.trim()) {
      basePrompt += `\n\nВАЖНО: При генерации обязательно учти следующий контекст или ключевые слова: "${additionalText}"`;
    }

    // Identify target videos
    const targets = applyToAll 
      ? videoFiles.filter(v => v.geminiFile) 
      : videoFiles.filter(v => v.id === activeVideoId && v.geminiFile);

    if (targets.length === 0) {
      setIsLoading(false);
      return;
    }

    try {
      // Process all targets in parallel
      const results = await Promise.all(targets.map(async (v) => {
        try {
          const resp = await generateContent(
            basePrompt,
            isTextMode ? null : functions({
              set_timecodes: (args) => args // Return args to be handled later
            }),
            v.geminiFile,
          );
          return { id: v.id, resp, success: true };
        } catch (e) {
          console.error(`Error processing ${v.name}`, e);
          return { id: v.id, success: false, error: (e as Error).message };
        }
      }));

      // Update state with results
      setVideoFiles(prev => prev.map(v => {
        const res = results.find(r => r.id === v.id);
        if (res && res.success) {
          if (isTextMode) {
             const parsed = parseSeoResponse(res.resp.text);
             return { ...v, textResponse: res.resp.text, seoData: parsed };
          } else {
             const call = res.resp.functionCalls?.[0];
             if (call && call.name === 'set_timecodes') {
                const timecodes = call.args.timecodes.map((t: any) => ({...t, text: t.text.replaceAll("\\'", "'")}));
                return { ...v, timecodeList: timecodes };
             }
          }
        }
        return v;
      }));

      // Update active view if the active video was processed
      const activeResult = results.find(r => r.id === activeVideoId);
      if (activeResult) {
        if (activeResult.success) {
           if (isTextMode) {
             setTextResponse(activeResult.resp.text);
             // seoData updated by useEffect
           } else {
             const call = activeResult.resp.functionCalls?.[0];
             if (call && call.name === 'set_timecodes') {
               const timecodes = call.args.timecodes.map((t: any) => ({...t, text: t.text.replaceAll("\\'", "'")}));
               setTimecodeList(timecodes);
             } else {
               setTextResponse('Ошибка: Некорректный ответ модели.');
             }
           }
        } else {
          setTextResponse(`Ошибка: ${activeResult.error}`);
        }
      }

    } catch (error) {
      console.error('Global generation error:', error);
      setTextResponse('Произошла общая ошибка.');
    } finally {
      setIsLoading(false);
      setAdditionalText(''); 
      setApplyToAll(false);
      scrollRef.current?.scrollTo({top: 0});
    }
  };

  const handleCorrection = async () => {
    if (!correctionText.trim()) return;
    const targetVideo = videoFiles.find(v => v.id === activeVideoId);
    if (!targetVideo || !targetVideo.geminiFile) return;

    setIsCorrecting(true);
    try {
      const prompt = `Откорректируй следующие метаданные видео на основе этой инструкции: "${correctionText}".

      Текущие метаданные:
      Title: ${seoData.title}
      Russian Title: ${seoData.russianTitle}
      Keywords: ${seoData.keywords}

      Верни обновленные метаданные строго в следующем формате:
      Title: [Обновленный заголовок на английском]
      Russian Title: [Обновленный заголовок на русском]
      Keywords: [Обновленные ключевые слова на английском, через запятую]`;

      const resp = await generateContent(prompt, null, targetVideo.geminiFile);
      const parsed = parseSeoResponse(resp.text);
      
      setSeoData(parsed);
      setTextResponse(resp.text);
      
      // Update persistent state
      setVideoFiles(prev => prev.map(v => 
        v.id === activeVideoId ? { ...v, textResponse: resp.text, seoData: parsed } : v
      ));

      setCorrectionText('');
    } catch (error) {
      console.error('Correction error', error);
    } finally {
      setIsCorrecting(false);
    }
  };

  const processAndUploadFiles = async (files: File[]) => {
    setIsUploading(true);
    setVideoError(false);

    const filteredFiles = files.filter((f) => f.type.startsWith('video/'));
    if (filteredFiles.length === 0) {
      setIsUploading(false);
      return;
    }

    const newVideoEntries: VideoFileEntry[] = filteredFiles.map((file) => ({
      id: self.crypto.randomUUID(),
      name: file.name,
      url: URL.createObjectURL(file),
      file: file,
      geminiFile: null,
      uploadError: null,
    }));

    setVideoFiles((prev) => [...prev, ...newVideoEntries]);

    if (activeVideoId === null) {
      setActiveVideoId(newVideoEntries[0].id);
    }

    await Promise.all(
      newVideoEntries.map(async (videoEntry) => {
        try {
          const geminiFile = await uploadFile(videoEntry.file);
          setVideoFiles((prev) =>
            prev.map((v) =>
              v.id === videoEntry.id ? {...v, geminiFile} : v,
            ),
          );
        } catch (err) {
          console.error('Upload failed for', videoEntry.name, err);
          setVideoFiles((prev) =>
            prev.map((v) =>
              v.id === videoEntry.id
                ? {...v, uploadError: 'Ошибка загрузки'}
                : v,
            ),
          );
          setVideoError(true);
        }
      }),
    );

    setIsUploading(false);
  };

  const uploadVideo = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files) as File[];
    if (files.length > 0) {
      await processAndUploadFiles(files);
    }
  };

  const handleFileSelect = async (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const files = Array.from(e.target.files) as File[];
    if (files.length > 0) {
      await processAndUploadFiles(files);
    }
    e.target.value = ''; // Allow selecting the same file again
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleClearAll = () => {
    videoFiles.forEach((video) => URL.revokeObjectURL(video.url));
    setVideoFiles([]);
    setActiveVideoId(null);
    setTimecodeList(null);
    setTextResponse(null);
    setRequestedTimecode(null);
    setActiveMode(undefined);
    setIsLoading(false);
    setVideoError(false);
    setSeoData({title: '', russianTitle: '', keywords: ''});
    setCorrectionText('');
    setAdditionalText('');
  };

  const handleRemoveVideo = (idToRemove: string) => {
    const videoToRemove = videoFiles.find((v) => v.id === idToRemove);
    if (!videoToRemove) return;

    URL.revokeObjectURL(videoToRemove.url);

    const remainingVideos = videoFiles.filter((v) => v.id !== idToRemove);

    if (activeVideoId === idToRemove) {
      if (remainingVideos.length === 0) {
        setActiveVideoId(null);
      } else {
        const originalIndex = videoFiles.findIndex((v) => v.id === idToRemove);
        const newIndex = Math.min(originalIndex, remainingVideos.length - 1);
        setActiveVideoId(remainingVideos[newIndex].id);
      }
    }

    setVideoFiles(remainingVideos);
  };

  return (
    <main
      className={theme}
      onDrop={uploadVideo}
      onDragOver={(e) => e.preventDefault()}
      onDragEnter={() => {}}
      onDragLeave={() => {}}>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileSelect}
        accept="video/*"
        multiple
        style={{display: 'none'}}
      />
      <section className="top">
        <div className="video-wrapper">
          {videoFiles.length > 0 && (
            <div className="video-tabs">
              {videoFiles.map((video) => (
                <button
                  key={video.id}
                  className={c('button', {
                    active: video.id === activeVideoId,
                  })}
                  onClick={() => setActiveVideoId(video.id)}>
                  <span className="videoName" title={video.name}>
                    {video.name}
                  </span>
                  <span className="status">
                    {video.uploadError && (
                      <span className="error" title={video.uploadError}>
                        ⚠️
                      </span>
                    )}
                    {!video.geminiFile && !video.uploadError && (
                      <span className="spinner"></span>
                    )}
                    {video.geminiFile && !video.uploadError && (
                      <span className="icon success" title="Загрузка завершена">
                        check
                      </span>
                    )}
                  </span>
                  <button
                    className="delete-video"
                    title="Удалить видео"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemoveVideo(video.id);
                    }}>
                    <span className="icon">close</span>
                  </button>
                </button>
              ))}
            </div>
          )}
          <VideoPlayer
            url={vidUrl}
            requestedTimecode={requestedTimecode}
            timecodeList={timecodeList}
            jumpToTimecode={setRequestedTimecode}
            isLoadingVideo={isUploading}
            videoError={videoError}
            onUploadClick={handleUploadClick}
            onClearAll={handleClearAll}
            hasVideos={videoFiles.length > 0}
          />
        </div>

        {videoFiles.length > 0 && (
          <>
            <button
              className="collapseButton"
              onClick={() => setShowSidebar(!showSidebar)}>
              <span className="icon">
                {showSidebar ? 'chevron_right' : 'chevron_left'}
              </span>
            </button>
            <div className={c('modeSelector', {hide: !showSidebar})}>
              {file && ( // Only show analysis tools if active video is processed
                <>
                  <div>
                    <h2>Анализировать видео с помощью:</h2>
                    <div className="modeList">
                      {Object.entries(modes).map(([mode, {emoji}]) => (
                        <button
                          key={mode}
                          className={c('button', {
                            active: mode === selectedMode,
                          })}
                          onClick={() => setSelectedMode(mode)}>
                          <span className="emoji">{emoji}</span> {mode}
                        </button>
                      ))}
                    </div>
                    {selectedMode === MODE_SEO && (
                      <div className="additionalOptions">
                        <textarea 
                          className="additionalInput"
                          placeholder="Доп. контекст (например: 'летнее настроение')"
                          rows={2}
                          value={additionalText}
                          onChange={(e) => setAdditionalText(e.target.value)}
                        />
                         <label className="checkboxLabel">
                          <input 
                            type="checkbox" 
                            checked={applyToAll}
                            onChange={(e) => setApplyToAll(e.target.checked)}
                          />
                          <span>Применить ко всем</span>
                        </label>
                      </div>
                    )}
                  </div>
                  <div>
                    <button
                      className="button generateButton"
                      onClick={() => onModeSelect(selectedMode)}>
                      ▶️ Создать
                    </button>
                  </div>
                </>
              )}
            </div>
          </>
        )}
      </section>

      <div className={c('tools', {inactive: !vidUrl})}>
        <section
          className={c('output', {['mode' + activeMode]: activeMode})}
          ref={scrollRef}>
          {isLoading ? (
            <div className="loading">
              Ожидание модели<span>...</span>
            </div>
          ) : textResponse && activeMode === MODE_SEO ? (
            <div className="seoOutput">
              <div className="correctionSection">
                <input
                  type="text"
                  className="correctionInput"
                  placeholder="Корректировать текущий результат..."
                  value={correctionText}
                  onChange={(e) => setCorrectionText(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCorrection()}
                  disabled={isCorrecting}
                />
                <button
                  className="correctionButton"
                  onClick={handleCorrection}
                  disabled={isCorrecting || !correctionText.trim()}>
                  {isCorrecting ? (
                    <span className="spinner"></span>
                  ) : (
                    <span className="icon">auto_fix</span>
                  )}
                </button>
              </div>
              {seoData.title && (
                <div className="seoSection">
                  <h3>Заголовок</h3>
                  <div className="copyableContent">
                    <textarea
                      value={seoData.title}
                      readOnly
                      rows={3}
                      aria-label="Заголовок"
                    />
                    <button
                      className={c('copyButton', {
                        copied: copiedPart === 'title',
                      })}
                      onClick={() => handleCopy(seoData.title, 'title')}
                      aria-label="Копировать заголовок">
                      <span className="icon">
                        {copiedPart === 'title' ? 'check' : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
              {seoData.russianTitle && (
                <div className="seoSection">
                  <h3>Заголовок (RU)</h3>
                  <div className="copyableContent">
                    <textarea
                      value={seoData.russianTitle}
                      readOnly
                      rows={3}
                      aria-label="Заголовок на русском"
                    />
                  </div>
                </div>
              )}
              {seoData.keywords && (
                <div className="seoSection">
                  <h3>Ключевые слова</h3>
                  <div className="copyableContent">
                    <textarea
                      value={seoData.keywords}
                      readOnly
                      rows={6}
                      aria-label="Ключевые слова"
                    />
                    <button
                      className={c('copyButton', {
                        copied: copiedPart === 'keywords',
                      })}
                      onClick={() =>
                        handleCopy(seoData.keywords, 'keywords')
                      }
                      aria-label="Копировать ключевые слова">
                      <span className="icon">
                        {copiedPart === 'keywords'
                          ? 'check'
                          : 'content_copy'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : textResponse ? (
            <div className="textOutput">{textResponse}</div>
          ) : timecodeList ? (
            <ul>
              {timecodeList.map(({time, text}, i) => (
                <li key={i} className="outputItem">
                  <button
                    onClick={() => setRequestedTimecode(timeToSecs(time))}>
                    <time>{time}</time>
                    <p className="text">{text}</p>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </div>
    </main>
  );
}
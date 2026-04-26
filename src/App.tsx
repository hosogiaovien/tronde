/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { UploadCloud, FileType, CheckCircle, Loader2, Download } from 'lucide-react';
import { parseQuestions, generateTests } from './lib/processDocx';
import JSZip from 'jszip';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [fileBuffer, setFileBuffer] = useState<ArrayBuffer | null>(null);
  const [detectedQuestions, setDetectedQuestions] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [numTests, setNumTests] = useState<number>(4);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = e.target.files?.[0];
    if (!uploadedFile) return;
    
    // reset states
    setFile(null);
    setFileBuffer(null);
    setError(null);
    setDetectedQuestions(null);
    setProgress(0);

    const name = uploadedFile.name.toLowerCase();
    if (!name.endsWith('.docx') && !name.endsWith('.doc')) {
      setError('Vui lòng upload file .docx');
      return;
    }

    setFile(uploadedFile);
    try {
      const buffer = await uploadedFile.arrayBuffer();
      setFileBuffer(buffer);
      
      // Attempt to parse to show detected questions
      const zip = await JSZip.loadAsync(buffer);
      const xmlBuffer = await zip.file('word/document.xml')?.async('text');
      if (!xmlBuffer) throw new Error("File word không chứa document.xml");
      
      const xmlDoc = new DOMParser().parseFromString(xmlBuffer, 'application/xml');
      const parseRes = parseQuestions(xmlDoc);
      if (parseRes.questions.length === 0) {
        setError(`Không tìm thấy câu hỏi. Xem định dạng: ${(parseRes as any).debugSample || 'Trống'}`);
        setDetectedQuestions(0);
        return;
      }
      setDetectedQuestions(parseRes.questions.length);
    } catch (err: any) {
      setError('Không thể đọc file: ' + err.message);
    }
  };

  const handleGenerate = async () => {
    if (!fileBuffer) return;
    setIsGenerating(true);
    setError(null);
    setProgress(0);

    try {
      await generateTests(fileBuffer, numTests, (p) => setProgress(p));
      // success toast could be added here
    } catch (err: any) {
      setError('Lỗi khi trộn đề: ' + err.message);
    } finally {
      setIsGenerating(false);
      setProgress(100);
      setTimeout(() => setProgress(0), 3000);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800">Hệ thống trộn đề trắc nghiệm giữ nguyên định dạng toán học và hình ảnh</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-500 hidden sm:inline">Hỗ trợ: .docx, .doc (Toán học & Hình ảnh)</span>
        </div>
      </header>

      <main className="flex-1 overflow-auto p-6 flex flex-col items-center">
        <div className="w-full max-w-2xl flex flex-col gap-6">

          {/* Instructions */}
          <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm rounded-xl p-4 leading-relaxed">
            <strong className="block mb-1">Quy định định dạng file Word:</strong>
            - Câu hỏi bắt đầu bằng "Câu 1. ", "Câu 2. "...<br/>
            - Các đáp án bắt đầu bằng "A. ", "B. ", "C. ", "D. "<br/>
            (Bắt buộc A,B,C,D là 4 dòng khác nhau hoặc A.... &lt;Tab&gt;B.... &lt;Tab&gt;C.... &lt;Tab&gt;D.... &lt;Tab&gt; để tránh sai sót)<br/>
            - <strong>Đáp án đúng:</strong> gạch chân (VD: <u>A</u>.)
          </div>

          {/* Upload Area */}
          <div className="relative bg-white rounded-2xl border-2 border-dashed border-slate-300 p-4 flex flex-col items-center justify-center text-center gap-2 transition-colors hover:border-blue-400 isolate overflow-hidden cursor-pointer">
            <input 
              type="file" 
              accept=".docx"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" 
            />
            {file ? (
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-1">
                  <FileType className="w-5 h-5" />
                </div>
                <span className="font-semibold text-sm text-slate-700">{file.name}</span>
                <span className="text-[10px] text-slate-400 mt-1">{(file.size / 1024).toFixed(1)} KB</span>
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mb-1">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                </div>
                <p className="text-sm font-semibold text-slate-700">Tải lên tệp đề thi gốc</p>
                <p className="text-[10px] text-slate-400 mt-1">Kéo thả hoặc nhấn để chọn tệp .docx</p>
              </div>
            )}
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-4 rounded-xl border border-red-200">
              {error}
            </div>
          )}

          {detectedQuestions !== null && detectedQuestions > 0 && !error && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center">
              <CheckCircle className="w-5 h-5 text-green-600 mr-2 shrink-0" />
              <span className="font-medium text-green-800 text-sm">Tìm thấy {detectedQuestions} câu hỏi hợp lệ trong file.</span>
            </div>
          )}

          {detectedQuestions !== null && detectedQuestions === 0 && !error && (
            <div className="bg-orange-50 border border-orange-200 text-orange-800 rounded-xl p-4 text-sm">
              Không tìm thấy câu hỏi nào. Vui lòng kiểm tra lại cấu trúc file Word.
            </div>
          )}

          {/* Settings Panel */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6 flex flex-col gap-6">
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Cấu hình trộn đề</h2>
            
            <div className="space-y-4">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-medium text-slate-500">Số lượng mã đề cần tạo</label>
                <div className="flex items-center gap-3">
                  <input 
                    type="number"
                    min="1"
                    max="24"
                    value={numTests}
                    onChange={(e) => setNumTests(parseInt(e.target.value) || 1)}
                    className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-shadow"
                  />
                  <span className="text-xs text-slate-400">Đề tối đa: 24</span>
                </div>
              </div>

              {/* Just static visuals matching the design template */}
              <div className="flex items-center justify-between py-2 opacity-80 pointer-events-none">
                <div className="flex flex-col">
                  <span className="text-sm text-slate-700">Đảo thứ tự câu hỏi</span>
                  <span className="text-[10px] text-slate-400">Random vị trí Câu 1, Câu 2...</span>
                </div>
                <div className="w-10 h-5 bg-blue-600 rounded-full relative">
                  <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div>
                </div>
              </div>

              <div className="flex items-center justify-between py-2 opacity-80 pointer-events-none">
                <div className="flex flex-col">
                  <span className="text-sm text-slate-700">Đảo thứ tự đáp án (A-D)</span>
                  <span className="text-[10px] text-slate-400">Nhận diện qua từ khóa gạch chân</span>
                </div>
                <div className="w-10 h-5 bg-blue-600 rounded-full relative">
                  <div className="absolute right-1 top-1 w-3 h-3 bg-white rounded-full"></div>
                </div>
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={!fileBuffer || detectedQuestions === 0 || isGenerating}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded-xl shadow-lg shadow-blue-200 transition-all disabled:opacity-50 disabled:shadow-none disabled:hover:bg-blue-600 flex justify-center items-center gap-2 mt-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" /> Trộn... {Math.round(progress)}%
                </>
              ) : (
                <>BẮT ĐẦU TRỘN ĐỀ</>
              )}
            </button>
          </div>
          
        </div>
      </main>

      {/* Footer */}
      <footer className="h-10 bg-slate-800 flex items-center px-8 text-[13px] text-slate-400 justify-between shrink-0">
        <p>Được xây dựng bởi <a href="https://zalo.me/0985580587" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Quốc Hưng</a></p>
        <p>Trạng thái máy chủ: <span className="text-green-400">Sẵn sàng</span></p>
      </footer>
    </div>
  );
}

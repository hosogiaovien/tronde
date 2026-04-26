const regex = /^\s*[cC][aâ]u\s+\d+[\.\:]?\s*/;
const str1 = "Câu 1. Phương trình";
const str2 = "Câu 1: Phương trình";
const str3 = "Câu 1 : Phương trình";
console.log(str1.match(regex)[0], "->", str1.substring(str1.match(regex)[0].length));
console.log(str2.match(regex)[0], "->", str2.substring(str2.match(regex)[0].length));
// console.log(str3.match(regex)[0], "->", str3.substring(str3.match(regex)[0].length));

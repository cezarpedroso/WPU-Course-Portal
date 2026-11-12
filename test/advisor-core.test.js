const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const core=require('../advisor-core.js');

function loadWindowData(file,key){const sandbox={window:{}};vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);return sandbox.window[key]}
const degreeMap=loadWindowData('degree-map-data.js','DEGREE_MAP_DATA');

test('parses course rows from copied unofficial transcript text',()=>{
  const rows=core.transcriptCourses('APCS201 Programming Fundamentals 2.00 B Curriculum No APCS206 Object Oriented Programming 2.00 C- Curriculum No HIST132 American History Since 1900 3.00 W Curriculum No');
  assert.deepEqual(rows.map(row=>[row.code,row.grade]),[['APCS 201','B'],['APCS 206','C-'],['HIST 132','W']]);
});

test('only counts passing transcript records as completed',()=>{
  const completed=core.completedCodes([{code:'APCS 201',grade:'B'},{code:'APCS 206',grade:'C-'},{code:'APCS 220',grade:'F'},{code:'MATH 140',grade:'W'}]);
  assert.deepEqual([...completed],['APCS 201','APCS 206']);
});

test('loads Software Engineering degree requirements from the Degree Map',()=>{
  const courses=core.programCourses('Software Engineering (Applied Computer Science)',degreeMap);
  assert.ok(courses.some(course=>course.code==='APCS 215'));
  assert.ok(courses.some(course=>course.code==='APCS 360'));
  assert.ok(courses.some(course=>course.code==='APCS 350'));
});

test('blocks a course when a listed prerequisite is incomplete',()=>{
  const course={code:'APCS 350',prereq:'APCS 206, APCS 220; MATH 212 recommended'};
  const result=core.eligible(course,new Set(['APCS 206']));
  assert.equal(result.eligible,false);
  assert.deepEqual(result.missing,['APCS 220','MATH 212']);
});

test('creates a credit-capped recommendation from completed coursework',()=>{
  const completed=new Set(['APCS 111','APCS 201','APCS 206','APCS 220','APCS 265','APCS 312','MATH 140','MATH 220']);
  const result=core.recommendations('Software Engineering (Applied Computer Science)',degreeMap,completed,9);
  assert.ok(result.selected.length>0);
  assert.ok(result.credits<=9);
  assert.ok(result.selected.every(course=>!completed.has(course.code)));
});

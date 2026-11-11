const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const test=require('node:test');
const core=require('../planner-core.js');

function loadWindowData(file,key){
  const sandbox={window:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),sandbox);
  return sandbox.window[key];
}
const enrollment=loadWindowData('enrollment-data.js','ENROLLMENT_DATA');
const degreeMap=loadWindowData('degree-map-data.js','DEGREE_MAP_DATA');

test('advances terms through the academic calendar',()=>{
  assert.equal(core.nextTerm('FA2026'),'SP2027');
  assert.equal(core.nextTerm('SP2027'),'SU2027');
  assert.equal(core.nextTerm('SU2027'),'FA2027');
});

test('matches enrollment majors to their Degree Map program',()=>{
  assert.equal(core.programFor('Accounting',degreeMap).name,'Accounting');
  assert.equal(core.programFor('Applied Computer Science - Computer Science',degreeMap).name,'Computer Science (Applied Computer Science)');
  assert.equal(core.programFor('Major Undecided',degreeMap),null);
});

test('loads actual Accounting catalog courses and academic-year levels',()=>{
  const courses=core.mapCourses('Accounting',degreeMap);
  assert.ok(courses.length>=20);
  assert.ok(courses.some(course=>course.code==='BUSI 201'&&course.level==='Sophomore'));
  assert.ok(courses.some(course=>course.code==='BUSI 301'&&course.level==='Junior'));
  assert.equal(new Set(courses.map(course=>course.code)).size,courses.length);
});

test('forecasts Spring Accounting enrollment from same-term history',()=>{
  assert.equal(core.forecast(enrollment,'Accounting','SP2027'),222);
  assert.equal(core.forecast(enrollment,'Accounting','SP2027','Freshman'),50);
  assert.equal(core.forecast(enrollment,'Accounting','SP2027','Sophomore'),75);
});

test('selects the smallest classroom meeting capacity and feature needs',()=>{
  const rooms=[
    {room:'Small',capacity:24,features:'computers'},
    {room:'Lab',capacity:30,features:'computers, lab'},
    {room:'Large',capacity:45,features:'computers, lab'}
  ];
  assert.equal(core.fitRoom(rooms,{seats:28,features:'lab'},40).room,'Lab');
  assert.equal(core.fitRoom(rooms,{seats:40,features:'lab'},40).room,'Large');
  assert.equal(core.fitRoom(rooms,{seats:20,features:'simulation'},20),null);
});

test('calculates demand, sections, and a room recommendation together',()=>{
  const course={level:'Sophomore',rate:.5,seats:24,features:''};
  const result=core.calculateCourse(enrollment,'Accounting','SP2027',[{room:'MTC 103',capacity:24}],course);
  assert.deepEqual(result,{students:38,sections:2,room:{room:'MTC 103',capacity:24}});
});

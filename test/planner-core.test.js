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
const catalog=loadWindowData('course-catalog-data.js','WPU_COURSE_CATALOG');

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

test('loads actual Accounting catalog courses and course-number levels',()=>{
  const courses=core.mapCourses('Accounting',degreeMap);
  assert.ok(courses.length>=20);
  assert.ok(courses.some(course=>course.code==='BUSI 201'&&course.courseLevel==='Sophomore'));
  assert.ok(courses.some(course=>course.code==='BUSI 301'&&course.courseLevel==='Junior'));
  assert.equal(new Set(courses.map(course=>course.code)).size,courses.length);
});

test('joins official catalog descriptions without presenting a course number as a term recommendation',()=>{
  const courses=core.mapCourses('Applied Computer Science - Computer Science',degreeMap,catalog);
  const apcs111=courses.find(course=>course.code==='APCS 111');
  assert.equal(apcs111.name,'Introduction to Technology Topics');
  assert.match(apcs111.description,/recent trend in technology/i);
  assert.match(apcs111.offering,/fall and spring/i);
  assert.equal(apcs111.courseLevel,'Freshman');
  assert.equal(apcs111.recommended,null);
});

test('maps Mechanical Engineering to its official 3+2 degree-map program',()=>{
  assert.equal(core.programFor('Engineering - Mechanical',degreeMap).name,'Engineering 3+2 (ISU) – Mechanical');
  assert.ok(core.mapCourses('Engineering - Mechanical',degreeMap,catalog).some(course=>course.code==='APCS 201'));
  assert.equal(core.programFor('Master of Sport Management',degreeMap),null);
});

test('keeps pivot detail values out of the major list and preserves Mechanical source counts',()=>{
  assert.equal(enrollment.majors.GR,undefined);
  assert.equal(enrollment.majors.DC,undefined);
  assert.equal(enrollment.majors.Postgraduate,undefined);
  assert.equal(enrollment.majors['Engineering - Mechanical'].reportedTotal,undefined);
  const term=enrollment.majors['Engineering - Mechanical'].terms.FA2026;
  assert.equal(term.headcount,201);
  assert.equal(Object.values(term.levels).reduce((sum,value)=>sum+value,0),201);
});

test('reports enrollment labels that need an explicit program mapping',()=>{
  const coverage=core.enrollmentMappingCoverage(enrollment,degreeMap);
  assert.ok(coverage.mappedLabels.includes('Engineering - Mechanical'));
  assert.ok(coverage.unmappedLabels.includes('Master of Sport Management'));
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

test('aggregates a scheduled course across all major programs while exposing the unquantified minor source',()=>{
  const map={programs:[
    {id:'major-a',name:'Program A',kind:'Major',inc:[],items:[{t:'c',codes:['APCS 201'],title:'Programming Fundamentals'}]},
    {id:'major-b',name:'Program B',kind:'Major',inc:[],items:[{t:'c',codes:['APCS 201'],title:'Programming Fundamentals'}]},
    {id:'minor',name:'Applied Computer Science',kind:'Minor',inc:[],items:[{t:'c',codes:['APCS 201'],title:'Programming Fundamentals'}]}
  ],courses:{'APCS 201':{code:'APCS 201',title:'Programming Fundamentals'}}};
  const fixture={majors:{'Program A':{terms:{SP2026:{headcount:10,levels:{Freshman:10}}}},'Program B':{terms:{SP2026:{headcount:20,levels:{Freshman:20}}}}}};
  const plans={programs:{'Program A':{courses:{'APCS 201':{year:'Freshman',terms:['Spring']}}},'Program B':{courses:{'APCS 201':{year:'Freshman',terms:['Spring']}}}}};
  const result=core.courseDemand(fixture,map,plans,'APCS 201','SP2027');
  assert.equal(result.students,30);
  assert.deepEqual(result.majorPrograms,['Program A','Program B']);
  assert.deepEqual(result.minorPrograms,['Applied Computer Science']);
  assert.equal(result.minorDemandAvailable,false);
});

test('withholds course demand when the official program placement is absent',()=>{
  const map={programs:[{id:'major-a',name:'Program A',kind:'Major',inc:[],items:[{t:'c',codes:['APCS 201'],title:'Programming Fundamentals'}]}],courses:{'APCS 201':{code:'APCS 201',title:'Programming Fundamentals'}}};
  const fixture={majors:{'Program A':{terms:{SP2026:{headcount:10,levels:{Freshman:10}}}}}};
  const result=core.courseDemand(fixture,map,{programs:{}},'APCS 201','SP2027');
  assert.equal(result.students,null);
  assert.deepEqual(result.unsequencedPrograms,['Program A']);
});

test('does not recommend classrooms without capacity or with an explicit inventory restriction',()=>{
  const rooms=[
    {room:'No capacity',capacity:null,features:'computers'},
    {room:'Not a classroom',capacity:30,features:'computers',planningEligible:false},
    {room:'Usable lab',capacity:30,features:'computers'}
  ];
  assert.equal(core.fitRoom(rooms,{seats:24,features:'computers'},24).room,'Usable lab');
});

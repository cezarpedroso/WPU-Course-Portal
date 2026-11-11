(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.WPUPlannerCore=api;
})(typeof window==='undefined'?globalThis:window,function(){
  const aliases={
    'Applied Computer Science - Computer Science':'Computer Science (Applied Computer Science)',
    'Applied Computer Science - Software Engineering':'Software Engineering (Applied Computer Science)',
    'Applied Computer Science- Information Technology':'Information Technology (Applied Computer Science)',
    'Accounting- General':'Accounting',
    'Accounting- Public':'Accounting'
  };
  const levelNames={1:'Freshman',2:'Sophomore',3:'Junior',4:'Senior',5:'Graduate'};
  function normalize(value){return String(value||'').toLowerCase().replace(/\(.*?\)/g,'').replace(/[^a-z0-9]+/g,' ').trim()}
  function nextTerm(term){const season=term.slice(0,2),year=Number(term.slice(2));return season==='FA'?'SP'+(year+1):season==='SP'?'SU'+year:'FA'+year}
  function termOrder(term){return ({SP:0,SU:1,FA:2}[term.slice(0,2)]+Number(term.slice(2))*3)}
  function catalogLevel(code){const match=String(code||'').match(/\s(\d)\d\d/);return match?(levelNames[match[1]]||'Senior'):'Senior'}
  function programFor(major,degreeMap){const wanted=normalize(aliases[major]||major),programs=(degreeMap.programs||[]).filter(p=>p.kind==='Major');return programs.find(p=>normalize(p.name)===wanted)||programs.find(p=>normalize(p.name).includes(wanted)||wanted.includes(normalize(p.name)))||null}
  function mapCourses(major,degreeMap){const root=programFor(major,degreeMap);if(!root)return[];const programs=degreeMap.programs||[],blocks=[],visited=new Set();function add(program){if(!program||visited.has(program.id))return;visited.add(program.id);(program.inc||[]).forEach(id=>add(programs.find(candidate=>candidate.id===id)));blocks.push(program)}add(root);const codes=new Set();return blocks.flatMap(block=>block.items||[]).filter(item=>item.t==='c'&&item.codes&&item.codes.length).map(item=>{const code=item.codes[0];if(codes.has(code))return null;codes.add(code);const detail=(degreeMap.courses||{})[code]||{};return{code,name:detail.title||item.title||code,level:catalogLevel(code),rate:1,seats:24,features:''}}).filter(Boolean)}
  function sameTermRecords(enrollment,major,term){return Object.entries(enrollment.majors[major].terms).filter(([candidate])=>candidate.slice(0,2)===term.slice(0,2)).sort((a,b)=>termOrder(a[0])-termOrder(b[0]))}
  function forecast(enrollment,major,term,level){const values=sameTermRecords(enrollment,major,term).map(([,entry])=>level?(Number(entry.levels[level])||0):Number(entry.headcount)).slice(-4);if(!values.length)return 0;const average=values.reduce((sum,value)=>sum+value,0)/values.length;if(values.length===1)return Math.round(average);const middle=(values.length-1)/2;let numerator=0,denominator=0;values.forEach((value,index)=>{numerator+=(index-middle)*(value-average);denominator+=(index-middle)*(index-middle)});return Math.max(0,Math.round(average+(denominator?numerator/denominator:0)))}
  function fitRoom(rooms,course,students){if(!students)return null;const target=Math.min(Math.max(1,Number(course.seats)||1),students),needs=String(course.features||'').toLowerCase().split(',').map(value=>value.trim()).filter(Boolean);return rooms.filter(room=>room.capacity>=target&&needs.every(need=>(String(room.room||'')+' '+String(room.building||'')+' '+String(room.features||'')).toLowerCase().includes(need))).sort((a,b)=>a.capacity-b.capacity)[0]||null}
  function calculateCourse(enrollment,major,term,rooms,course){const students=Math.round(forecast(enrollment,major,term,course.level)*(Number(course.rate)||0));return{students,sections:Math.ceil(students/Math.max(1,Number(course.seats)||1)),room:fitRoom(rooms,course,students)}}
  return{aliases,normalize,nextTerm,termOrder,catalogLevel,programFor,mapCourses,sameTermRecords,forecast,fitRoom,calculateCourse};
});

/* .js files add interaction to your website */

/* button */
var quoteList = ["Women's Rights are Human Rights", "MY body MY choice", "No uterus, no opinion", "Bans off our bodies", "Abortion is Healthcare", "Keep abortion safe and legal", "Enough is Enough", "I will NOT go quietly back to the 1950s"];
// look for quotes
var quote = document.getElementById("quote");
// button
var myBtn = document.getElementById("myBtn");
var count = 0;
// waiting for button click
myBtn.addEventListener("click", displayQuote);
// define displayQuote
function displayQuote(){
  quote.innerHTML = quoteList[count];
  count++;
  if(count == quoteList.length){
    count = 0;
  }
}


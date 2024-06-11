using System;
using System.Collections.Generic;
using System.Linq;
using System.Text;
using System.Drawing;

namespace DotsUtil
{
    public class DotRenderer
    {
        private const int TryMultiplyer = 10;
        private const int INT_Offset = 6;
        private string sRep { get; set; }

        private Font _f = new Font(FontFamily.Families.Where((x)=>{return x.Name == "Comic Sans MS";}).First(),15);
        public Font F
        {
            get
            {
                return _f;
            }
            set
            {
                _f = value;
            }
        }
        private int _Offset;
        const int MaxCircleSize = 7;
        const int SmallestCircleSize = 4;

        int LetterSize
        { get;  set; }

        


        int AverageCircleSize
        {
            get
            {
                return (MaxCircleSize + _Offset + SmallestCircleSize) / 2;
            }
        }


        Rectangle R;

        int NumberOfDots; 
        Bitmap _Image = null;
        public Bitmap Image    
        {
            get
            {
                return _Image;
            }
            private set
            {
                _Image = value;
            }
        }
        //Func<Bitmap bp,int Count> Update;
        public DotRenderer(int iNumber)
        {
            NumberOfDots = iNumber;
            sRep = iNumber.ToString();
            _Offset = INT_Offset;
            CreateBitMap();
            
            //Bp = new Bitmap
        }

        public event Action<int,int, Bitmap> LetterUpddate;
        public event Action< int, Bitmap> ImageUpdated;

        public static int PixelsToPoints(Graphics G, int PixelCount)
        {
            int ftsize =(int) Math.Round(((PixelCount / G.DpiY) *  (72)));
            return ftsize;
        }

        public static int PointsToPixel(Graphics G, int Points)
        {
            return (int) Math.Round((Points / 72) * G.DpiY);
        }


        void CallLetterUpdated(int num,int ToDraw,Bitmap b )
        {
            if(LetterUpddate == null)
            {
                return;
            }
            LetterUpddate(num,ToDraw,b);
                

        }

        public void DrawIt()
        {
            int[] NumberToDraw = new int[sRep.Length];
            GetNumberOfDotToDrawPerLetter(NumberToDraw);
            //Draw Each Letter 
            int total = 0;
            for (int x = 0; x < sRep.Length; x++) 
            {
                char c = sRep[x];
                _Offset = INT_Offset;
                Bitmap B = DrawNumber(c, NumberToDraw[x]);
                
                CallLetterUpdated(NumberToDraw[x],NumberToDraw[x], B);
                total += NumberToDraw[x];
                AppendLetter(x,total, B);                

            }
        }

        private void GetNumberOfDotToDrawPerLetter(int[] NumberToDraw)
        {
            float TotalWeight = sRep.Sum((x) => FillePercentage[Convert.ToInt32(x.ToString())]);
            //TotalWeight = TotalWeight / sRep.Length;
            for (int lt = 0; lt < sRep.Length; lt++)
            {
                int Num = sRep[lt] - '0';
                NumberToDraw[lt] = (int)(NumberOfDots * (FillePercentage[Num] / TotalWeight));

            }
            int SumofDots;
            int InsertPosition= 0;
            while ((SumofDots = NumberToDraw.Sum()) != NumberOfDots)
            {
                if(++InsertPosition > NumberToDraw.GetUpperBound(0)) 
                    InsertPosition = 0;
                int Increment = SumofDots > NumberOfDots ? -1 : 1;
                NumberToDraw[InsertPosition] += Increment;
            }


        }

        private void AppendLetter(int x,int NumberDrawn, Bitmap B)
        {
            Graphics G = Graphics.FromImage(Image);
            G.DrawImageUnscaled(B, new Point(LetterWidth * x, 0));
            FireImageUpdated(NumberDrawn, Image);
        }

        
        private void FireImageUpdated(int NumberDrawn,Bitmap Image)
        {
            if(ImageUpdated != null)
            {
                
                ImageUpdated(NumberDrawn, Image);
            }
        }

        const double WidthToHeightFactor = .65;
        const double LetXOffsetFactor = -.3;
        const double LetYOffsetFactor = -.3;
        const double LetterFactor = 1.1;
        public int LetterWidth;
        private Bitmap DrawNumber(char c,int numdotForletter)
        {
            Bitmap Bp =  new Bitmap( LetterWidth,LetterSize);
            
            Graphics G = Graphics.FromImage(Bp);
            G.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.HighQuality;
            G.FillRectangle(Brushes.White, new Rectangle(0, 0,  LetterWidth,LetterSize));
            float FontSize = (float) ( PixelsToPoints(G, LetterSize) * LetterFactor);
            
            Font fs = new Font(F.FontFamily,FontSize);
            G.DrawString(c.ToString(), fs, Brushes.Black, new PointF((float)(LetXOffsetFactor * LetterWidth), (float)(LetYOffsetFactor * LetterSize)));
            G.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAlias;
            Rectangle R = new Rectangle();
            bool[,] Map = DeterminMap(Bp,ref R);
            G.FillRectangle(Brushes.White, new Rectangle(0, 0,LetterWidth, LetterSize ));
            G.DrawRectangle(new Pen(Brushes.White), new Rectangle(0, 0, Bp.Width, Bp.Height));
            int org = numdotForletter;
            
            int MaxX= R.X+R.Width;
            int MaxY = R.Y + R.Height;
            int MinX = R.X;
            int MinY = R.Y;
            int TryCount = 0;
            while( numdotForletter-- != 0)
            {
                Dot D = null;
                
                if (TryCount < org * TryMultiplyer)
                {
                    D = new Dot(SmallestCircleSize, MaxCircleSize, MaxX, MaxY, MinX, MinY);
                }
                else
                {
                    D = new Dot(SmallestCircleSize, SmallestCircleSize, MaxX, MaxY, MinX, MinY);
                }
                
                do
                {
                    if (++TryCount > org * TryMultiplyer)
                    {

                        D = new Dot(SmallestCircleSize, SmallestCircleSize, MaxX, MaxY, MinX, MinY);
                        if (TryCount > org * TryMultiplyer * 3)
                        {
                            D = FindNextFree(ref Map,D);
                        }
                    }
                    D.FindPoint();
                    
                }
                while (!isValidPoint(D.Rect,ref Map));
                G.FillEllipse(new SolidBrush(D.DotColor), D.Rect);
                G.DrawEllipse(new Pen(Brushes.Black), D.Rect);
                
                CallLetterUpdated(org - numdotForletter,org, Bp);
                UpdatedateMap(D.Rect,ref Map);
            }
            return Bp;
        }

        private Dot FindNextFree(ref bool[,] Map,Dot D)
        {
            if (_Offset > 0)
            {
                _Offset -= 2;
            }
            Dot RetDot  = D;
            int h, w;
            D.FindPoint();
            h = Map.GetUpperBound(1);
            w = Map.GetUpperBound(0);
            bool Exit = false;
            for (int x = D.Rect.X; x < w && Exit == false; x++)
            {
                for (int y = D.Rect.Y; y < h && Exit == false; y++)
                {
                    if (Map[x, y] == true)
                    {
                        int Offsetx = x + _Offset / 2;
                        int OffsetY = y + _Offset / 2;

                        RetDot = new Dot(SmallestCircleSize, SmallestCircleSize, Offsetx, OffsetY, Offsetx, OffsetY);
                        RetDot.FindPoint();
                        if (isValidPoint(RetDot.Rect,ref Map))
                        {
                            Exit = true;
                        }

                    }
                    
                }
            }
            return RetDot;
        }

        private bool[,] DeterminMap(Bitmap Bp,ref Rectangle Bounds)
        {
            int h,w;
            h = Bp.Height;
            w = Bp.Width;
            bool[,] retval = new bool[w,h];
            int FirstX, FirstY, LastX, LastY;
            LastX = LastY = 0;
            FirstY = FirstX = int.MaxValue;
            
            for (int x = 0; x < w; x++)
            {
                for (int y = 0; y < h; y++)
                {
                    Color c = Bp.GetPixel(x, y);

                    bool Val = (c.R == 0 && c.B == 0 && c.G == 0);
                    retval[x, y] = Val;
                    if (Val == true)
                    {
                        FirstX = (x < FirstX) ? x : FirstX;
                        FirstY = (y < FirstY) ? y : FirstY;
                        LastX = (x > LastX) ? x : LastX;
                        LastY = (y > LastY) ? y : LastY;
                    }
                }

            }
            Bounds = new Rectangle(FirstX, FirstY, LastX - FirstX, LastY - FirstY);
            return retval;
        }

        float[] _FillPercengage = null;
        float[] FillePercentage
        {
            get
            {
                if (_FillPercengage == null)
                {
                    const int TsSize = 50;
                    _FillPercengage = new float[TryMultiplyer];
                    
                    for (int x = 0; x <= 9; x++)
                    {
                        Bitmap TstBitMap = new Bitmap((int)( TsSize* WidthToHeightFactor),TsSize);
                        Graphics G = Graphics.FromImage(TstBitMap);
                        Font TsFont = new Font(F.FontFamily, (int)(DotRenderer.PixelsToPoints(G,TsSize )* LetterFactor), FontStyle.Regular);
                        G.DrawString(x.ToString(), TsFont, Brushes.Black, new PointF((float)(TsSize * LetXOffsetFactor),(float)( TsSize * LetYOffsetFactor)));
                        _FillPercengage[x] = GetPerCentage(TstBitMap,TsSize,(int)(TsSize* WidthToHeightFactor));
                    }
                }
                return _FillPercengage; 
            }
        }

        private float GetPerCentage(Bitmap TstBitMap,int Height, int Width)
        {
            

            int Counted = 0;
            for (int x = 0; x < Width; x++ )
            {
                for (int y = 0; y < Height; y++)
                {
                    if (TstBitMap.GetPixel(x, y).ToArgb() == Color.Black.ToArgb())
                    {
                        Counted++;
                    }
                }
            }
            float ret = ((float) Counted) / ((float) (Height * Width));
            return ret;
        }

        private void CreateBitMap()
        {
            string s = NumberOfDots.ToString();
            float AverageCoverage = CalcAverageCoverage();
            int NumberNeeded = NumberOfDots / s.Length ; 
            double AreaofAvgCirc = Math.Pow(((AverageCircleSize )/2),2) *Math.PI ; 
            int Act = 0; 
            int testSize = 100;
            do
            {
                Act = Convert.ToInt32(Math.Floor((testSize * (testSize * WidthToHeightFactor) * AverageCoverage) / AreaofAvgCirc));
                testSize =(int) (Convert.ToDouble(testSize) * 1.25 ); 
            }while (Act < NumberNeeded);
            LetterSize = testSize;
            LetterWidth =Convert.ToInt32( LetterSize * WidthToHeightFactor );
            int SpaceBetweenLetter =(int) Math.Floor(.0 * Act);
            int xSize = (LetterWidth + SpaceBetweenLetter ) *s.Length ;
            int ySize = testSize;

            Image = new Bitmap(xSize, ySize);
            //Determin Size of Bitmap 
            //Size of bit Map = (Number of Dots)/Number of letter 
            
            
            
        }

        private float CalcAverageCoverage()
        {
            float retVal = 0;
            string s = NumberOfDots.ToString();
            for (int x = 0; x < s.Length; x++)
            {
                int Num = int.Parse( s[x].ToString() );
                retVal += FillePercentage[Num];
            }
            return retVal / s.Length; 
        }

        bool[,] GetCircle(int w)
        {
            if (!Circs.ContainsKey(w))
            {
                Circs[w] = CreateCircle(w);
            }
            return Circs[w];
        }

        private bool isValidPoint(Rectangle Rect,ref bool[,]Map)
        {
            
            int w = Rect.Width;
            
            bool[,] C = GetCircle(w + _Offset);
            bool Ret = true;
            for (int x = 0; x < C.GetUpperBound(0); x++)
            {
                for (int y = 0; y < C.GetUpperBound(1); y++)
                {
                    try
                    {
                        bool bCirc = C[x, y];
                        bool bMap = Map[x + Rect.X -((_Offset / 2)), y + Rect.Y - (_Offset / 2)];
                        bool r = (!bCirc || bMap);
                        if (r == false)
                        {
                            return false;
                        }
                    }
                    catch
                    {
                        return false;
                    }
                }
            }
            return Ret;

        }
        static Dictionary<int, bool[,]> Circs = new Dictionary<int, bool[,]>();
        private bool[,] CreateCircle(int w)
        {
            Bitmap Bp = new Bitmap(w,w);
            bool[,] retCirc = new bool[w, w];
            Graphics G = Graphics.FromImage(Bp);
            G.FillRectangle(Brushes.White, new Rectangle(0, 0, w, w));
            G.FillEllipse(Brushes.Black,new Rectangle(0,0,w,w));
            //Bp.Save("C:\\users\\adam\\tst.bmp");
            for (int x = 0; x < w; x++)
            {
                for (int y = 0; y < w; y++)
                {
                   Color C = Bp.GetPixel(x,y);

                   retCirc[x, y] = (C.B == 0 && C.R == 0 && C.G == 0);
                }
            }
            return retCirc;
        }



        internal void UpdatedateMap(Rectangle Rect,ref bool[,] Map)
        {
            int w = Rect.Width;
            bool[,] Circ = GetCircle(w  );
            for (int x = 0; x < w; x++)
            {
                
                for (int y = 0; y < Rect.Height; y++)
                {
                    try
                    {
                        bool bCirc = Circ[x, y];
                        bool bMap = Map[x + Rect.X , y + Rect.Y ];
                        bool r = !(bCirc || (!bMap));
                        Map[x + Rect.X, y + Rect.Y] = r;
                    }
                    catch
                    { }
                }
            }
        }
    }
}
